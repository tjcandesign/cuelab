"""Free play: no scoring, just stats accumulation."""

from __future__ import annotations

from typing import Any

from ..engine.base import ball_number
from .base import BaseMode


class FreeMode(BaseMode):
    mode = "free"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.shots = 0
        self.pockets = 0
        self.scratches = 0

    async def start(self) -> None:
        self.phase = "live"

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if etype != "shot_end":
            return
        pocketed_list = [
            bp for bp in (data.get("ballsPocketed") or [])
            if ball_number(str(bp.get("ballId", ""))) > 0
        ]
        scratch = bool(data.get("cueScratched"))
        self.shots += 1
        self.pockets += len(pocketed_list)
        if scratch:
            self.scratches += 1
        if self.current_player_id is not None:
            player = self.player(self.current_player_id)
            if player is not None:
                player["shots"] += 1
            self.record_attempt(
                self.current_player_id,
                len(pocketed_list),
                bool(pocketed_list),
                scratch,
                None,
            )
        await self.mgr.push()

    def message(self) -> str:
        if self.phase == "ended":
            return "Session complete"
        return "Free play"

    def _extra(self) -> dict[str, Any]:
        return {
            "shots": self.shots,
            "pockets": self.pockets,
            "scratches": self.scratches,
        }
