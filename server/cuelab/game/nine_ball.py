"""Nine ball: track the rack, auto-record pockets, rotate on misses.
Simple but correct; rack state rides in snapshot.extra."""

from __future__ import annotations

from typing import Any

from ..engine.base import ball_number
from .base import ActionError, BaseMode


class NineBallMode(BaseMode):
    mode = "nine_ball"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.remaining: set[int] = set(range(1, 10))
        self.rack = 1
        self._idx = 0

    async def start(self) -> None:
        self.phase = "live"
        if self.players:
            self.current_player_id = self.players[self._idx]["id"]

    # -------------------------------------------------------------- actions

    async def action(self, name: str, params: dict[str, Any]) -> None:
        if name == "end":
            await self.finish()
        elif name == "foul":
            self._do_foul()
        elif name == "rerack":
            await self._do_rerack()
        elif name == "next":
            self._rotate()
        else:
            raise ActionError(f"unknown action {name!r} for nine_ball")

    def _do_foul(self) -> None:
        if self.current_player_id is not None:
            self.record_attempt(self.current_player_id, 0, False, True, None)
        self._rotate()

    async def _do_rerack(self) -> None:
        self.remaining = set(range(1, 10))
        self.rack += 1
        if self.phase == "rack_done":
            if self.round >= self.total_rounds:
                await self.finish()
                return
            self.round += 1
        self.phase = "live"
        self._rotate()
        engine = self.mgr.get_engine()
        reset = getattr(engine, "reset", None)
        if callable(reset):
            reset(None)

    def _rotate(self) -> None:
        if not self.players:
            return
        self._idx = (self._idx + 1) % len(self.players)
        self.current_player_id = self.players[self._idx]["id"]

    # ----------------------------------------------------------- game logic

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if etype == "ball_pocketed":
            number = ball_number(str(data.get("ballId", "")))
            self.remaining.discard(number)
            await self.mgr.push()
        elif etype == "shot_end" and self.phase == "live":
            self._score_shot(data)
            await self.mgr.push()

    def _score_shot(self, data: dict[str, Any]) -> None:
        shooter_id = self.current_player_id
        pocketed_list = data.get("ballsPocketed") or []
        object_pocketed = [
            bp for bp in pocketed_list
            if 1 <= ball_number(str(bp.get("ballId", ""))) <= 9
        ]
        scratch = bool(data.get("cueScratched"))
        points = len(object_pocketed)
        if shooter_id is not None:
            player = self.player(shooter_id)
            if player is not None:
                player["shots"] += 1
            self.record_attempt(
                shooter_id, points, bool(object_pocketed), scratch, None
            )
            self.last_result = {
                "playerId": shooter_id,
                "points": points,
                "pocketed": bool(object_pocketed),
                "scratch": scratch,
                "ring": None,
            }
        if 9 not in self.remaining:
            self.phase = "rack_done"
        elif scratch or not object_pocketed:
            self._rotate()

    # ------------------------------------------------------------- snapshot

    def message(self) -> str:
        name = self.player_name(self.current_player_id)
        if self.phase == "rack_done":
            return "Rack complete — rerack to continue"
        if self.phase == "ended":
            return "Session complete"
        on_ball = min(self.remaining) if self.remaining else None
        return f"{name}: shooting (on the {on_ball})" if on_ball else f"{name}: shooting"

    def _extra(self) -> dict[str, Any]:
        return {
            "remaining": sorted(self.remaining),
            "onBall": min(self.remaining) if self.remaining else None,
            "rack": self.rack,
        }

    def scene(self) -> list[dict[str, Any]]:
        if self.phase == "rack_done":
            return [self.scene_text("RACK COMPLETE", color="success")]
        if self.phase == "ended":
            return [self.scene_text("SESSION COMPLETE")]
        return []
