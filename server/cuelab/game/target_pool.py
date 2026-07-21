"""Target pool: the flagship FusionCue-style flow.

setting -> call_pocket -> target_shown -> per shooter (random order):
placing -> countdown -> live -> result -> ... -> round_done -> next round
(setter rotates). Score: called ball in called pocket + no scratch, then
6/4/2 by which bullseye ring the cue ball settles in."""

from __future__ import annotations

import asyncio
import math
import random
from typing import Any

from ..engine.base import Ball
from .base import ActionError, BaseMode, POCKET_IDS

RING_RADII = [90.0, 180.0, 270.0]
RING_SCORES = [6, 4, 2]
TARGET_CLEARANCE_MM = 250.0


class TargetPoolMode(BaseMode):
    mode = "target_pool"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.setter_idx = 0
        self.shoot_order: list[int] = []
        self.shooter_pos = -1
        self.called_ball: str | None = None
        self._countdown_task: asyncio.Task | None = None
        self._phase_task: asyncio.Task | None = None
        self._placing_matched = False

    # ------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        self._enter_setting()

    def _enter_setting(self) -> None:
        self.phase = "setting"
        self.setter_id = self.players[self.setter_idx]["id"]
        self.current_player_id = self.setter_id
        self.layout = []
        self.called_pocket = None
        self.called_ball = None
        self.target = None
        self.countdown = None
        self.shoot_order = []
        self.shooter_pos = -1

    # -------------------------------------------------------------- actions

    async def action(self, name: str, params: dict[str, Any]) -> None:
        if name == "end":
            await self.finish()
        elif name == "lock_layout":
            self._do_lock_layout()
        elif name == "call_pocket":
            self._do_call_pocket(str(params.get("pocket", "")))
        elif name == "rescore":
            self._do_rescore(params)
        elif name == "next":
            await self._do_next()
        else:
            raise ActionError(f"unknown action {name!r} for target_pool")

    def _do_lock_layout(self) -> None:
        if self.phase != "setting":
            raise ActionError(f"lock_layout not valid in phase {self.phase}")
        engine = self.mgr.get_engine()
        balls = [b for b in engine.balls() if b.settled]
        cue = next((b for b in balls if b.id == "cue"), None)
        objects = sorted(
            (b for b in balls if b.id != "cue"), key=lambda b: b.number
        )
        if cue is None or not objects:
            raise ActionError("place the cue ball and one object ball first")
        self.layout = [
            {"ballId": b.id, "x": round(b.x, 1), "y": round(b.y, 1)}
            for b in [cue, *objects]
        ]
        self.called_ball = objects[0].id
        self.phase = "call_pocket"

    def _do_call_pocket(self, pocket: str) -> None:
        if self.phase != "call_pocket":
            raise ActionError(f"call_pocket not valid in phase {self.phase}")
        if pocket not in POCKET_IDS:
            raise ActionError(f"unknown pocket {pocket!r}")
        self.called_pocket = pocket
        self.target = self._place_target()
        order = [p["id"] for p in self.players]
        random.shuffle(order)
        self.shoot_order = order
        self.shooter_pos = -1
        self.phase = "target_shown"
        self._phase_task = self.mgr.schedule(
            self.mgr.timing.target_shown, self._advance_shooter
        )

    def _do_rescore(self, params: dict[str, Any]) -> None:
        player_id = params.get("playerId")
        points = params.get("points")
        if not isinstance(player_id, int) or not isinstance(points, int):
            raise ActionError("rescore needs playerId and points (integers)")
        player = self.player(player_id)
        if player is None:
            raise ActionError(f"player {player_id} not in session")
        row = self.mgr.db.query_one(
            "SELECT id, points FROM attempts WHERE session_id=? AND player_id=?"
            " ORDER BY id DESC LIMIT 1",
            (self.session_id, player_id),
        )
        if row is None:
            raise ActionError("no attempt to rescore for that player")
        delta = points - row["points"]
        self.mgr.db.execute(
            "UPDATE attempts SET points=? WHERE id=?", (points, row["id"])
        )
        player["score"] += delta
        self.mgr.db.execute(
            "UPDATE session_players SET score=? WHERE session_id=? AND player_id=?",
            (player["score"], self.session_id, player_id),
        )
        if self.last_result and self.last_result.get("playerId") == player_id:
            self.last_result["points"] = points

    async def _do_next(self) -> None:
        self._cancel_phase_tasks()
        if self.phase == "setting":
            self._do_lock_layout()
        elif self.phase == "call_pocket":
            self._do_call_pocket(random.choice(POCKET_IDS))
        elif self.phase == "target_shown":
            await self._advance_shooter()
        elif self.phase == "placing":
            self._begin_countdown()
        elif self.phase == "countdown":
            self.countdown = None
            self.phase = "live"
        elif self.phase == "live":
            await self._score_shot({"ballsPocketed": [], "cueScratched": False})
        elif self.phase == "result":
            await self._advance_shooter()
        elif self.phase == "round_done":
            await self._next_round()
        elif self.phase == "ended":
            pass

    # ----------------------------------------------------------- game logic

    def _place_target(self) -> dict[str, Any]:
        length, width = self.mgr.table_dims()
        lo_x, hi_x = TARGET_CLEARANCE_MM, length - TARGET_CLEARANCE_MM
        lo_y, hi_y = TARGET_CLEARANCE_MM, width - TARGET_CLEARANCE_MM
        best: tuple[float, float] = (length / 2, width / 2)
        best_min = -1.0
        for _ in range(500):
            x = random.uniform(lo_x, hi_x)
            y = random.uniform(lo_y, hi_y)
            min_d = min(
                (
                    math.hypot(x - e["x"], y - e["y"])
                    for e in self.layout
                ),
                default=1e9,
            )
            if min_d >= TARGET_CLEARANCE_MM:
                best = (x, y)
                break
            if min_d > best_min:
                best_min, best = min_d, (x, y)
        return {
            "c": [round(best[0], 1), round(best[1], 1)],
            "radii": list(RING_RADII),
            "scores": list(RING_SCORES),
        }

    async def _advance_shooter(self) -> None:
        if self.ended:
            return
        self.shooter_pos += 1
        self.last_result = None
        if self.shooter_pos >= len(self.shoot_order):
            self.phase = "round_done"
            self._phase_task = self.mgr.schedule(
                self.mgr.timing.result, self._next_round
            )
            await self.mgr.push()
            return
        self.phase = "placing"
        self.current_player_id = self.shoot_order[self.shooter_pos]
        self._placing_matched = False
        await self.mgr.push()

    async def _next_round(self) -> None:
        if self.ended:
            return
        if self.round >= self.total_rounds:
            await self.finish()
            return
        self.round += 1
        self.setter_idx = (self.setter_idx + 1) % len(self.players)
        self._enter_setting()
        await self.mgr.push()

    async def on_state(self, balls: list[Ball]) -> None:
        if self.phase != "placing" or self._placing_matched:
            return
        if self.layout_matches(balls, self.layout):
            self._placing_matched = True
            await self.mgr.emit_ws_event(
                "layout_matched",
                {"sessionId": self.session_id, "playerId": self.current_player_id},
            )
            self._begin_countdown()
            await self.mgr.push()

    def _begin_countdown(self) -> None:
        self.phase = "countdown"
        self._countdown_task = self.mgr.spawn(self._run_countdown())

    async def _run_countdown(self) -> None:
        for value in (5, 4, 3, 2, 1):
            self.countdown = value
            await self.mgr.push()
            await asyncio.sleep(self.mgr.timing.countdown)
        self.countdown = None
        self.phase = "live"
        await self.mgr.push()

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if etype == "shot_end" and self.phase in ("live", "countdown"):
            if self.phase == "countdown":
                self._cancel_phase_tasks()
                self.countdown = None
            await self._score_shot(data)
            await self.mgr.push()

    async def _score_shot(self, data: dict[str, Any]) -> None:
        shooter_id = self.current_player_id
        if shooter_id is None:
            return
        pocketed_list = data.get("ballsPocketed") or []
        scratch = bool(data.get("cueScratched"))
        pocketed_ok = any(
            bp.get("ballId") == self.called_ball
            and bp.get("pocket") == self.called_pocket
            for bp in pocketed_list
        )
        ring: int | None = None
        points = 0
        if pocketed_ok and not scratch and self.target:
            engine = self.mgr.get_engine()
            cue = next((b for b in engine.balls() if b.id == "cue"), None)
            ring = 0
            if cue is not None:
                cx, cy = self.target["c"]
                d = math.hypot(cue.x - cx, cue.y - cy)
                for i, radius in enumerate(self.target["radii"]):
                    if d <= radius:
                        ring = i + 1
                        points = self.target["scores"][i]
                        break
        player = self.player(shooter_id)
        if player is not None:
            player["shots"] += 1
        self.record_attempt(shooter_id, points, pocketed_ok, scratch, ring)
        self.last_result = {
            "playerId": shooter_id,
            "points": points,
            "pocketed": pocketed_ok,
            "scratch": scratch,
            "ring": ring,
        }
        self.phase = "result"
        self._phase_task = self.mgr.schedule(
            self.mgr.timing.result, self._advance_shooter
        )

    def _cancel_phase_tasks(self) -> None:
        for task in (self._countdown_task, self._phase_task):
            if task is not None and not task.done():
                task.cancel()
        self._countdown_task = None
        self._phase_task = None

    # ------------------------------------------------------------- snapshot

    def message(self) -> str:
        name = self.player_name(self.current_player_id)
        setter = self.player_name(self.setter_id)
        if self.phase == "setting":
            return f"{setter}: place cue + object ball"
        if self.phase == "call_pocket":
            return f"{setter}: call a pocket"
        if self.phase == "target_shown":
            return "Target locked"
        if self.phase == "placing":
            return f"{name}: place balls on the spots"
        if self.phase == "countdown":
            return f"{name}: shoot in {self.countdown}"
        if self.phase == "live":
            return f"{name}: shoot!"
        if self.phase == "result" and self.last_result:
            return f"{name}: {self.last_result['points']} points"
        if self.phase == "round_done":
            return f"Round {self.round} complete"
        if self.phase == "ended":
            return "Session complete"
        return ""

    def scene(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        items += self.scene_target()
        items += self.scene_called_pocket()
        if self.phase == "setting":
            items.append(self.scene_text("PLACE CUE + ONE OBJECT BALL"))
        elif self.phase == "call_pocket":
            items.append(self.scene_text("CALL A POCKET"))
        elif self.phase == "target_shown":
            items.append(self.scene_text("TARGET LOCKED", color="accent", dy=-320))
        elif self.phase == "placing":
            items += self.scene_ghosts(self.layout)
            items.append(
                self.scene_text("PLACE BALLS BACK ON THE SPOTS", dy=-320, size=48)
            )
        elif self.phase == "countdown":
            items += self.scene_ghosts(self.layout)
            items += self.scene_countdown()
        elif self.phase == "result" and self.last_result:
            points = self.last_result["points"]
            color = "success" if points > 0 else "danger"
            label = f"{points} POINTS" if not self.last_result["scratch"] else "SCRATCH"
            items.append(self.scene_text(label, color=color, dy=-320, size=90))
        elif self.phase == "round_done":
            items.append(self.scene_text(f"ROUND {self.round} COMPLETE"))
        elif self.phase == "ended":
            items.append(self.scene_text("SESSION COMPLETE"))
        return items
