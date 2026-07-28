"""Shot metrics: segment shots via shot_start/shot_end, buffer the state
frames in between, compute FusionCue-style metrics, persist + broadcast.

Shots are only tracked (and persisted) while a session is active. Frame
pairs are linearly interpolated for the contact test so sparse broadcasts
(idle rate, scaled sim time) still catch the first cue/object touch."""

from __future__ import annotations

import json
import logging
import math
import time
from typing import TYPE_CHECKING, Any

from ..engine.base import BALL_DIAMETER, BALL_RADIUS, Ball

if TYPE_CHECKING:
    from .manager import GameManager

log = logging.getLogger("cuelab.shots")

MMS_PER_MPH = 447.04
CONTACT_DIST_MM = BALL_DIAMETER + 6.0  # cue center to object center
RAIL_PROXIMITY_MM = 40.0  # of the cushion contact plane
CUE_SPEED_WINDOW_S = 0.4  # peak-speed window after shot_start
MAX_PATH_POINTS = 120  # per ball, after downsampling
MAX_FRAMES = 4000  # hard cap on the frame buffer

# frame: (ts, {ball_id: (x, y, vx, vy)})
Frame = tuple[float, dict[str, tuple[float, float, float, float]]]


def _segment_point_distance(
    a0: tuple[float, float],
    a1: tuple[float, float],
    p: tuple[float, float],
) -> float:
    """Closest approach of segment a0->a1 to the static point p."""
    dx, dy = a1[0] - a0[0], a1[1] - a0[1]
    seg2 = dx * dx + dy * dy
    if seg2 < 1e-9:
        return math.hypot(a0[0] - p[0], a0[1] - p[1])
    t = min(max(((p[0] - a0[0]) * dx + (p[1] - a0[1]) * dy) / seg2, 0.0), 1.0)
    return math.hypot(a0[0] + t * dx - p[0], a0[1] + t * dy - p[1])


class ShotTracker:
    """Buffers ball frames between shot_start and shot_end, then computes
    metrics, persists a shots row, and emits WS `shot_recorded`."""

    def __init__(self, mgr: "GameManager") -> None:
        self.mgr = mgr
        self._active = False
        self._t0 = 0.0
        self._frames: list[Frame] = []
        self._session_id: int | None = None
        self._player_id: int | None = None
        self._round: int | None = None

    # ------------------------------------------------------------- ingestion

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if etype == "shot_start":
            self._begin()
        elif etype == "shot_end" and self._active:
            await self._finalize(data)

    def on_state(self, balls: list[Ball]) -> None:
        if not self._active or len(self._frames) >= MAX_FRAMES:
            return
        self._frames.append(
            (time.time(), {b.id: (b.x, b.y, b.vx, b.vy) for b in balls})
        )

    def _begin(self) -> None:
        mode = self.mgr.active
        if mode is None or mode.ended:
            self._active = False
            return
        self._active = True
        self._t0 = time.time()
        self._session_id = mode.session_id
        self._player_id = mode.current_player_id
        self._round = mode.round
        # seed with the pre-shot layout so paths start where the balls stood
        self._frames = []
        try:
            self.on_state(self.mgr.get_engine().balls())
        except Exception:
            pass

    # ------------------------------------------------------------ finalizing

    async def _finalize(self, data: dict[str, Any]) -> None:
        self._active = False
        frames = self._frames
        self._frames = []
        session_id = self._session_id
        if session_id is None:
            return
        try:
            metrics = self._compute_metrics(frames, data)
            paths = self._compute_paths(frames)
        except Exception:
            log.exception("shot metric computation failed")
            return
        shot_id = self.mgr.db.execute(
            "INSERT INTO shots (session_id, player_id, round, ts_start, ts_end,"
            " metrics_json, paths_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                self._player_id,
                self._round,
                int(self._t0 * 1000),
                int(time.time() * 1000),
                json.dumps(metrics),
                json.dumps(paths),
            ),
        )
        await self.mgr.emit_ws_event(
            "shot_recorded",
            {"shotId": shot_id, "sessionId": session_id, "metrics": metrics},
        )

    def _compute_metrics(
        self, frames: list[Frame], data: dict[str, Any]
    ) -> dict[str, Any]:
        length, width = self.mgr.table_dims()
        pocketed = [
            {"ballId": bp.get("ballId"), "pocket": bp.get("pocket")}
            for bp in (data.get("ballsPocketed") or [])
        ]
        made: bool | None = None
        mode = self.mgr.active
        if mode is not None and mode.session_id == self._session_id:
            made = mode.last_shot_made
            mode.last_shot_made = None
        return {
            "cueSpeedMph": self._cue_speed_mph(frames),
            "firstContact": self._first_contact(frames),
            "objectTravelPct": self._object_travel_pct(frames, length),
            "railContacts": self._rail_contacts(frames, length, width),
            "pocketed": pocketed,
            "scratch": bool(data.get("cueScratched")),
            "made": made,
            "trackedFrames": len(frames),
        }

    def _cue_speed_mph(self, frames: list[Frame]) -> float:
        peak = 0.0
        for ts, balls in frames:
            if ts - self._t0 > CUE_SPEED_WINDOW_S:
                break
            cue = balls.get("cue")
            if cue is not None:
                peak = max(peak, math.hypot(cue[2], cue[3]))
        return round(peak / MMS_PER_MPH, 2)

    def _first_contact(self, frames: list[Frame]) -> str | None:
        """First object ball the cue closes to <= 2r+6 mm. The cue path is
        interpolated across each frame pair; the object is held at its
        interval-start position (it was at rest until first contact)."""
        for i in range(len(frames) - 1):
            _, f0 = frames[i]
            _, f1 = frames[i + 1]
            cue0, cue1 = f0.get("cue"), f1.get("cue")
            if cue0 is None or cue1 is None:
                continue
            best_id: str | None = None
            best_d = CONTACT_DIST_MM
            for ball_id, o0 in f0.items():
                if ball_id == "cue":
                    continue
                d = _segment_point_distance(
                    (cue0[0], cue0[1]), (cue1[0], cue1[1]), (o0[0], o0[1])
                )
                if d <= best_d:
                    best_id, best_d = ball_id, d
            if best_id is not None:
                return best_id
        return None

    def _object_travel_pct(self, frames: list[Frame], length: float) -> float:
        total = 0.0
        for i in range(len(frames) - 1):
            _, f0 = frames[i]
            _, f1 = frames[i + 1]
            for ball_id, o0 in f0.items():
                if ball_id == "cue":
                    continue
                o1 = f1.get(ball_id)
                if o1 is not None:
                    total += math.hypot(o1[0] - o0[0], o1[1] - o0[1])
        return round(total / length * 100.0, 1)

    def _rail_contacts(
        self, frames: list[Frame], length: float, width: float
    ) -> int:
        """Cue-ball velocity sign flips within 40 mm of a cushion plane."""
        count = 0
        near = RAIL_PROXIMITY_MM
        for i in range(len(frames) - 1):
            c0 = frames[i][1].get("cue")
            c1 = frames[i + 1][1].get("cue")
            if c0 is None or c1 is None:
                continue
            if c0[2] * c1[2] < 0:  # vx flip -> left/right cushion
                d = min(
                    abs(c0[0] - BALL_RADIUS), abs(c1[0] - BALL_RADIUS),
                    abs(length - BALL_RADIUS - c0[0]),
                    abs(length - BALL_RADIUS - c1[0]),
                )
                if d <= near:
                    count += 1
            if c0[3] * c1[3] < 0:  # vy flip -> top/bottom cushion
                d = min(
                    abs(c0[1] - BALL_RADIUS), abs(c1[1] - BALL_RADIUS),
                    abs(width - BALL_RADIUS - c0[1]),
                    abs(width - BALL_RADIUS - c1[1]),
                )
                if d <= near:
                    count += 1
        return count

    def _compute_paths(self, frames: list[Frame]) -> list[dict[str, Any]]:
        by_ball: dict[str, list[list[float]]] = {}
        for _, balls in frames:
            for ball_id, (x, y, _, _) in balls.items():
                by_ball.setdefault(ball_id, []).append([round(x, 1), round(y, 1)])
        paths = []
        for ball_id, pts in by_ball.items():
            if len(pts) > MAX_PATH_POINTS:
                stride = math.ceil(len(pts) / MAX_PATH_POINTS)
                sampled = pts[::stride]
                if sampled[-1] != pts[-1]:
                    sampled.append(pts[-1])
                pts = sampled[:MAX_PATH_POINTS]
            paths.append({"id": ball_id, "pts": pts})
        return paths
