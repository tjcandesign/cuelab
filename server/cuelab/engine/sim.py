"""Sim engine: full 2D table physics in millimeters.

Substeps at 240 Hz driven by a monotonic clock; broadcasts ~30 Hz while
anything moves, ~4 Hz idle. Emits the same events the vision engine does,
so the game layer is engine-agnostic."""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..config import time_scale
from ..render import synthetic_camera_view
from .base import (
    BALL_RADIUS,
    Ball,
    Engine,
    EngineSink,
    ball_color,
    ball_kind,
    ball_number,
    pocket_map,
)

log = logging.getLogger("cuelab.sim")

SUBSTEP = 1.0 / 240.0
FRICTION = 300.0  # mm/s^2 linear deceleration
CUSHION_E = 0.75
BALL_E = 0.95
SETTLE_SPEED = 5.0  # mm/s -> clamp to zero
SHOT_SPEED = 100.0  # mm/s -> a settled->moving transition this fast is a shot
MAX_SHOT_SPEED = 6000.0


@dataclass
class _SimBall:
    id: str
    number: int
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0

    @property
    def speed(self) -> float:
        return math.hypot(self.vx, self.vy)


class SimEngine(Engine):
    mode = "sim"

    def __init__(
        self,
        table_l: float,
        table_w: float,
        sink: EngineSink | None = None,
    ) -> None:
        super().__init__(sink)
        self.table_l = table_l
        self.table_w = table_w
        self.pockets = pocket_map(table_l, table_w)
        self._balls: dict[str, _SimBall] = {}
        self._pending: list[tuple[str, dict[str, Any]]] = []
        self._moving = False
        self._shot_started_at = 0.0
        self._shot_pocketed: list[dict[str, str]] = []
        self._shot_scratched = False
        self._sim_time = 0.0
        self._task: asyncio.Task | None = None
        self._force_emit = False
        self._time_scale = time_scale()
        self.reset(None)
        self._pending.clear()

    # ---------------------------------------------------------------- control

    def reset(self, balls: list[dict[str, float]] | None) -> None:
        """Reset the layout. Default: cue at (0.25L, 0.5W) + 9-ball diamond
        near (0.75L, 0.5W)."""
        self._balls.clear()
        if balls:
            for spec in balls:
                bid = str(spec["id"])
                self._balls[bid] = _SimBall(
                    bid, ball_number(bid), float(spec["x"]), float(spec["y"])
                )
        else:
            length, width = self.table_l, self.table_w
            self._balls["cue"] = _SimBall("cue", 0, length * 0.25, width * 0.5)
            gap = BALL_RADIUS * 2 + 0.2
            row_dx = gap * math.sin(math.pi / 3)
            cx, cy = length * 0.75, width * 0.5
            diamond = [
                ("b1", cx - 2 * row_dx, cy),
                ("b2", cx - row_dx, cy - gap / 2),
                ("b3", cx - row_dx, cy + gap / 2),
                ("b4", cx, cy - gap),
                ("b9", cx, cy),
                ("b5", cx, cy + gap),
                ("b6", cx + row_dx, cy - gap / 2),
                ("b7", cx + row_dx, cy + gap / 2),
                ("b8", cx + 2 * row_dx, cy),
            ]
            for bid, x, y in diamond:
                self._balls[bid] = _SimBall(bid, ball_number(bid), x, y)
        self._moving = False
        self._force_emit = True

    def place(self, ball_id: str, x: float | None, y: float | None) -> None:
        """Place (or re-add) a ball. Cue with no coordinates returns to its
        default spot (the respawn rule after a scratch)."""
        if x is None or y is None:
            if ball_id == "cue":
                x, y = self.table_l * 0.25, self.table_w * 0.5
            else:
                raise ValueError(f"x,y required to place {ball_id!r}")
        x = min(max(x, BALL_RADIUS), self.table_l - BALL_RADIUS)
        y = min(max(y, BALL_RADIUS), self.table_w - BALL_RADIUS)
        existing = self._balls.get(ball_id)
        if existing is not None:
            existing.x, existing.y = x, y
            existing.vx = existing.vy = 0.0
        else:
            self._balls[ball_id] = _SimBall(ball_id, ball_number(ball_id), x, y)
            self._pending.append(("ball_added", {"ballId": ball_id}))
        self._force_emit = True

    def add(self, ball_id: str) -> None:
        if ball_id in self._balls:
            return
        x, y = self._find_free_spot()
        self._balls[ball_id] = _SimBall(ball_id, ball_number(ball_id), x, y)
        self._pending.append(("ball_added", {"ballId": ball_id}))
        self._force_emit = True

    def remove(self, ball_id: str) -> None:
        if ball_id not in self._balls:
            raise KeyError(ball_id)
        del self._balls[ball_id]
        self._pending.append(("ball_removed", {"ballId": ball_id}))
        self._force_emit = True

    def shoot(self, ball_id: str, angle_deg: float, speed: float) -> None:
        ball = self._balls.get(ball_id)
        if ball is None:
            raise KeyError(ball_id)
        speed = min(max(speed, 0.0), MAX_SHOT_SPEED)
        rad = math.radians(angle_deg)
        ball.vx = speed * math.cos(rad)
        ball.vy = speed * math.sin(rad)
        self._force_emit = True

    def _find_free_spot(self) -> tuple[float, float]:
        cx, cy = self.table_l / 2, self.table_w / 2
        for i in range(200):
            ang = i * 2.399963  # golden-angle spiral
            r = 40.0 * math.sqrt(i)
            x = min(max(cx + r * math.cos(ang), BALL_RADIUS), self.table_l - BALL_RADIUS)
            y = min(max(cy + r * math.sin(ang), BALL_RADIUS), self.table_w - BALL_RADIUS)
            if all(
                math.hypot(b.x - x, b.y - y) > BALL_RADIUS * 2.2
                for b in self._balls.values()
            ):
                return x, y
        return cx, cy

    # ---------------------------------------------------------------- physics

    def _step(self, dt: float) -> None:
        self._sim_time += dt
        balls = list(self._balls.values())

        # friction + integrate
        for b in balls:
            sp = b.speed
            if sp > 0.0:
                new_sp = max(0.0, sp - FRICTION * dt)
                if new_sp < SETTLE_SPEED:
                    b.vx = b.vy = 0.0
                else:
                    k = new_sp / sp
                    b.vx *= k
                    b.vy *= k
            b.x += b.vx * dt
            b.y += b.vy * dt

        # ball-ball collisions (equal mass, restitution BALL_E)
        for i in range(len(balls)):
            for j in range(i + 1, len(balls)):
                a, c = balls[i], balls[j]
                if a.id not in self._balls or c.id not in self._balls:
                    continue
                dx, dy = c.x - a.x, c.y - a.y
                dist2 = dx * dx + dy * dy
                min_d = BALL_RADIUS * 2
                if dist2 >= min_d * min_d:
                    continue
                dist = math.sqrt(dist2)
                if dist < 1e-6:
                    nx, ny, dist = 1.0, 0.0, min_d / 2
                else:
                    nx, ny = dx / dist, dy / dist
                overlap = min_d - dist
                a.x -= nx * overlap / 2
                a.y -= ny * overlap / 2
                c.x += nx * overlap / 2
                c.y += ny * overlap / 2
                van = a.vx * nx + a.vy * ny
                vcn = c.vx * nx + c.vy * ny
                if van - vcn <= 0:
                    continue  # separating already
                mean = (van + vcn) / 2
                rel = van - vcn
                new_van = mean - BALL_E * rel / 2
                new_vcn = mean + BALL_E * rel / 2
                a.vx += (new_van - van) * nx
                a.vy += (new_van - van) * ny
                c.vx += (new_vcn - vcn) * nx
                c.vy += (new_vcn - vcn) * ny

        # pocket capture (before cushion so balls fall in at the rails)
        for b in list(self._balls.values()):
            for pid, (px, py, cap) in self.pockets.items():
                dx, dy = b.x - px, b.y - py
                if dx * dx + dy * dy <= cap * cap:
                    del self._balls[b.id]
                    if b.id == "cue":
                        self._pending.append(("scratch", {"pocket": pid}))
                        if self._moving:
                            self._shot_scratched = True
                    else:
                        self._pending.append(
                            ("ball_pocketed", {"ballId": b.id, "pocket": pid})
                        )
                        if self._moving:
                            self._shot_pocketed.append(
                                {"ballId": b.id, "pocket": pid}
                            )
                    break

        # cushion reflection against rails inset by ball radius
        r, length, width = BALL_RADIUS, self.table_l, self.table_w
        for b in self._balls.values():
            if b.x < r:
                b.x = r
                if b.vx < 0:
                    b.vx = -b.vx * CUSHION_E
            elif b.x > length - r:
                b.x = length - r
                if b.vx > 0:
                    b.vx = -b.vx * CUSHION_E
            if b.y < r:
                b.y = r
                if b.vy < 0:
                    b.vy = -b.vy * CUSHION_E
            elif b.y > width - r:
                b.y = width - r
                if b.vy > 0:
                    b.vy = -b.vy * CUSHION_E

        # shot detection
        speeds = [b.speed for b in self._balls.values()]
        if not self._moving:
            if any(sp > SHOT_SPEED for sp in speeds):
                self._moving = True
                self._shot_started_at = self._sim_time
                self._shot_pocketed = []
                self._shot_scratched = False
                fastest = max(
                    self._balls.values(), key=lambda b: b.speed, default=None
                )
                self._pending.append(
                    ("shot_start", {"ballId": fastest.id if fastest else None})
                )
        else:
            if all(sp == 0.0 for sp in speeds):
                self._moving = False
                duration_ms = int((self._sim_time - self._shot_started_at) * 1000)
                self._pending.append(
                    (
                        "shot_end",
                        {
                            "durationMs": duration_ms,
                            "ballsPocketed": list(self._shot_pocketed),
                            "cueScratched": self._shot_scratched,
                        },
                    )
                )
                self._pending.append(("balls_settled", {}))

    def drain_events(self) -> list[tuple[str, dict[str, Any]]]:
        out = self._pending
        self._pending = []
        return out

    # ---------------------------------------------------------------- engine

    def balls(self) -> list[Ball]:
        out = []
        for b in sorted(self._balls.values(), key=lambda b: b.number):
            settled = b.speed == 0.0
            out.append(
                Ball(
                    id=b.id,
                    number=b.number,
                    kind=ball_kind(b.number),
                    x=b.x,
                    y=b.y,
                    vx=b.vx,
                    vy=b.vy,
                    settled=settled,
                    color=ball_color(b.number),
                )
            )
        return out

    @property
    def moving(self) -> bool:
        return self._moving

    def camera_frame(self) -> np.ndarray | None:
        return synthetic_camera_view(self.balls(), self.table_l, self.table_w)

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="sim-engine")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        last = time.monotonic()
        last_emit = 0.0
        acc = 0.0
        while True:
            await asyncio.sleep(1 / 120)
            now = time.monotonic()
            acc = min(acc + (now - last) * self._time_scale, 0.5)
            last = now
            while acc >= SUBSTEP:
                self._step(SUBSTEP)
                acc -= SUBSTEP
            events = self.drain_events()
            if self.sink is not None:
                for etype, data in events:
                    await self.sink.on_event(etype, data)
                interval = (1 / 30) if self._moving else (1 / 4)
                if self._force_emit or (now - last_emit) >= interval:
                    self._force_emit = False
                    last_emit = now
                    await self.sink.on_state(self.balls(), self._moving)
