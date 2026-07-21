"""Base game mode: snapshot shape, scene helpers, attempt persistence."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from ..engine.base import BALL_RADIUS, Ball

if TYPE_CHECKING:
    from .manager import GameManager

POCKET_IDS = ("tl", "ts", "tr", "bl", "bs", "br")
PLACEMENT_TOLERANCE_MM = 25.0


class ActionError(Exception):
    """Invalid game action for the current phase/params (-> HTTP 409)."""


class BaseMode:
    mode = "base"

    def __init__(
        self,
        mgr: "GameManager",
        session_id: int,
        players: list[dict[str, Any]],
        rounds: int,
        drill: dict[str, Any] | None = None,
    ) -> None:
        self.mgr = mgr
        self.session_id = session_id
        self.players = players
        self.total_rounds = max(1, rounds)
        self.round = 1
        self.phase = "idle"
        self.drill = drill
        self.current_player_id: int | None = players[0]["id"] if players else None
        self.setter_id: int | None = None
        self.called_pocket: str | None = None
        self.target: dict[str, Any] | None = None
        self.layout: list[dict[str, Any]] = []
        self.last_result: dict[str, Any] | None = None
        self.countdown: int | None = None
        self.ended = False

    # ------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        self.phase = "live"

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        pass

    async def on_state(self, balls: list[Ball]) -> None:
        pass

    async def action(self, name: str, params: dict[str, Any]) -> None:
        if name == "end":
            await self.finish()
            return
        raise ActionError(f"unknown action {name!r} for mode {self.mode}")

    async def finish(self) -> None:
        if self.ended:
            return
        self.ended = True
        self.phase = "ended"
        self.countdown = None
        self.mgr.cancel_tasks()
        self.mgr.persist_session_end(self)
        await self.mgr.push()

    # -------------------------------------------------------------- helpers

    def player(self, player_id: int | None) -> dict[str, Any] | None:
        for p in self.players:
            if p["id"] == player_id:
                return p
        return None

    def player_name(self, player_id: int | None) -> str:
        p = self.player(player_id)
        return p["name"] if p else "Player"

    def message(self) -> str:
        return ""

    def _extra(self) -> dict[str, Any]:
        return {}

    def snapshot(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "mode": self.mode,
            "phase": self.phase,
            "round": self.round,
            "totalRounds": self.total_rounds,
            "players": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "initials": p["initials"],
                    "color": p["color"],
                    "score": p["score"],
                    "shots": p["shots"],
                }
                for p in self.players
            ],
            "currentPlayerId": self.current_player_id,
            "setterId": self.setter_id,
            "message": self.message(),
            "countdown": self.countdown,
            "calledPocket": self.called_pocket,
            "target": self.target,
            "layout": self.layout,
            "lastResult": self.last_result,
            "extra": self._extra(),
        }

    def scene(self) -> list[dict[str, Any]]:
        return []

    # -------------------------------------------------------- scene helpers

    def _table_center(self) -> tuple[float, float]:
        cfg = self.mgr.table_dims()
        return cfg[0] / 2, cfg[1] / 2

    def scene_text(
        self, text: str, color: str = "white", dy: float = 0.0, size: int = 60
    ) -> dict[str, Any]:
        cx, cy = self._table_center()
        return {
            "kind": "text",
            "c": [round(cx, 1), round(cy + dy, 1)],
            "text": text,
            "size": size,
            "rot": 0,
            "color": color,
        }

    def scene_target(self) -> list[dict[str, Any]]:
        if not self.target:
            return []
        return [
            {
                "kind": "ring",
                "c": self.target["c"],
                "radii": self.target["radii"],
                "labels": [str(s) for s in self.target["scores"]],
                "color": "accent",
            }
        ]

    def scene_called_pocket(self) -> list[dict[str, Any]]:
        if not self.called_pocket:
            return []
        return [{"kind": "pocket", "pocket": self.called_pocket, "color": "accent"}]

    def scene_ghosts(self, layout: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items = []
        for entry in layout:
            ball_id = entry["ballId"]
            label = "CUE" if ball_id == "cue" else ball_id.lstrip("b")
            items.append(
                {
                    "kind": "ghost",
                    "c": [entry["x"], entry["y"]],
                    "r": BALL_RADIUS,
                    "color": "white",
                    "label": label,
                }
            )
        return items

    def scene_countdown(self) -> list[dict[str, Any]]:
        if self.countdown is None:
            return []
        cx, cy = self._table_center()
        return [
            {"kind": "countdown", "c": [round(cx, 1), round(cy, 1)], "value": self.countdown}
        ]

    # -------------------------------------------------- placement matching

    def layout_matches(self, balls: list[Ball], layout: list[dict[str, Any]]) -> bool:
        if not layout:
            return False
        by_id = {b.id: b for b in balls}
        for entry in layout:
            ball = by_id.get(entry["ballId"])
            if ball is None or not ball.settled:
                return False
            if math.hypot(ball.x - entry["x"], ball.y - entry["y"]) > PLACEMENT_TOLERANCE_MM:
                return False
        return True

    # ------------------------------------------------------------ scoring db

    def record_attempt(
        self,
        player_id: int,
        points: int,
        pocketed: bool,
        scratch: bool,
        ring: int | None,
    ) -> int:
        attempt_id = self.mgr.db.execute(
            "INSERT INTO attempts (session_id, player_id, round, points, pocketed,"
            " scratch, ring) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                self.session_id,
                player_id,
                self.round,
                int(points),
                1 if pocketed else 0,
                1 if scratch else 0,
                ring,
            ),
        )
        player = self.player(player_id)
        if player is not None:
            player["score"] += int(points)
            self.mgr.db.execute(
                "UPDATE session_players SET score=?, shots=? WHERE session_id=? AND player_id=?",
                (player["score"], player["shots"], self.session_id, player_id),
            )
        return attempt_id
