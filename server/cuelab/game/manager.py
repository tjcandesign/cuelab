"""Session manager: consumes engine events regardless of engine type,
owns the active game mode, broadcasts game snapshots + projector scenes."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from ..config import timer_scale
from ..db import Database
from ..engine.base import Ball, Engine
from ..hub import Hub
from .base import ActionError, BaseMode
from .drill import DrillMode
from .free import FreeMode
from .nine_ball import NineBallMode
from .target_pool import TargetPoolMode

log = logging.getLogger("cuelab.game")

MODE_CLASSES: dict[str, type[BaseMode]] = {
    "target_pool": TargetPoolMode,
    "nine_ball": NineBallMode,
    "drill": DrillMode,
    "free": FreeMode,
}


@dataclass
class Timing:
    countdown: float = 1.0
    result: float = 4.0
    target_shown: float = 3.0

    @classmethod
    def from_env(cls) -> "Timing":
        s = timer_scale()
        return cls(countdown=1.0 * s, result=4.0 * s, target_shown=3.0 * s)


class GameManager:
    def __init__(
        self,
        db: Database,
        hub: Hub,
        get_engine: Callable[[], Engine],
        table_dims: Callable[[], tuple[float, float]],
        timing: Timing | None = None,
    ) -> None:
        self.db = db
        self.hub = hub
        self.get_engine = get_engine
        self._table_dims = table_dims
        self.timing = timing or Timing.from_env()
        self.active: BaseMode | None = None
        self._tasks: set[asyncio.Task] = set()
        self._last_scene_json: str | None = None

    def table_dims(self) -> tuple[float, float]:
        return self._table_dims()

    # ------------------------------------------------------------- sessions

    async def create_session(
        self,
        mode: str,
        player_ids: list[int],
        rounds: int,
        drill_id: int | None,
    ) -> dict[str, Any]:
        cls = MODE_CLASSES.get(mode)
        if cls is None:
            raise ActionError(f"unknown mode {mode!r}")
        players: list[dict[str, Any]] = []
        for pid in player_ids:
            row = self.db.query_one("SELECT * FROM players WHERE id=?", (pid,))
            if row is None:
                raise KeyError(f"player {pid} not found")
            players.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "initials": row["initials"],
                    "color": row["color"],
                    "score": 0,
                    "shots": 0,
                }
            )
        if mode == "target_pool" and not players:
            raise ActionError("target_pool needs at least one player")
        drill: dict[str, Any] | None = None
        if mode == "drill":
            if drill_id is None:
                raise ActionError("drill mode needs drillId")
            row = self.db.query_one("SELECT * FROM drills WHERE id=?", (drill_id,))
            if row is None:
                raise KeyError(f"drill {drill_id} not found")
            drill = json.loads(row["json"])
            drill["id"] = row["id"]

        if self.active is not None and not self.active.ended:
            await self.active.finish()
        self.cancel_tasks()

        session_id = self.db.execute(
            "INSERT INTO sessions (mode, drill_id, rounds) VALUES (?, ?, ?)",
            (mode, drill_id, rounds),
        )
        for p in players:
            self.db.execute(
                "INSERT INTO session_players (session_id, player_id) VALUES (?, ?)",
                (session_id, p["id"]),
            )
        self.active = cls(self, session_id, players, rounds, drill=drill)
        await self.active.start()
        await self.push()
        return self.active.snapshot()

    async def action(
        self, session_id: int, name: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        mode = self.active
        if mode is None or mode.session_id != session_id:
            raise KeyError(f"session {session_id} is not active")
        await mode.action(name, params)
        await self.push()
        return mode.snapshot()

    def snapshot(self) -> dict[str, Any] | None:
        return self.active.snapshot() if self.active else None

    def persist_session_end(self, mode: BaseMode) -> None:
        summary = {
            "players": [
                {"id": p["id"], "name": p["name"], "score": p["score"], "shots": p["shots"]}
                for p in mode.players
            ],
            "rounds": mode.round,
            "mode": mode.mode,
        }
        self.db.execute(
            "UPDATE sessions SET ended_at=datetime('now'), summary_json=? WHERE id=?",
            (json.dumps(summary), mode.session_id),
        )
        for p in mode.players:
            self.db.execute(
                "UPDATE session_players SET score=?, shots=? WHERE session_id=? AND player_id=?",
                (p["score"], p["shots"], mode.session_id, p["id"]),
            )
            self.db.execute(
                "UPDATE players SET last_active=datetime('now') WHERE id=?", (p["id"],)
            )

    # ------------------------------------------------------------ eventing

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if self.active is not None and not self.active.ended:
            try:
                await self.active.on_event(etype, data)
            except Exception:
                log.exception("game on_event failed")

    async def on_state(self, balls: list[Ball]) -> None:
        if self.active is not None and not self.active.ended:
            try:
                await self.active.on_state(balls)
            except Exception:
                log.exception("game on_state failed")

    async def emit_ws_event(self, etype: str, data: dict[str, Any]) -> None:
        self.db.log_event(etype, data)
        await self.hub.broadcast({"type": "event", "event": etype, "data": data})

    async def push(self) -> None:
        """Broadcast the game snapshot and (if changed) the projector scene."""
        snap = self.snapshot()
        await self.hub.broadcast({"type": "game", "game": snap})
        items = self.active.scene() if self.active else []
        scene_json = json.dumps(items, sort_keys=True)
        if scene_json != self._last_scene_json:
            self._last_scene_json = scene_json
            await self.hub.broadcast({"type": "scene", "items": items})

    # --------------------------------------------------------------- tasks

    def spawn(self, coro: Awaitable[None]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def schedule(
        self, delay: float, fn: Callable[[], Awaitable[None]]
    ) -> asyncio.Task:
        async def runner() -> None:
            try:
                await asyncio.sleep(delay)
                await fn()
            except asyncio.CancelledError:
                pass
            except Exception:
                log.exception("scheduled game step failed")

        return self.spawn(runner())

    def cancel_tasks(self) -> None:
        for task in list(self._tasks):
            if not task.done():
                task.cancel()
        self._tasks.clear()
