"""WebSocket broadcast hub. Caches the latest state/game/scene message so
new clients get a full picture on connect."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("cuelab.hub")


class Hub:
    def __init__(self) -> None:
        self.clients: dict[WebSocket, str] = {}
        self.latest: dict[str, dict[str, Any]] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients[ws] = "viewer"
        for key in ("state", "game", "scene"):
            msg = self.latest.get(key)
            if msg is None:
                if key == "game":
                    msg = {"type": "game", "game": None}
                elif key == "scene":
                    msg = {"type": "scene", "items": []}
                else:
                    continue
            try:
                await ws.send_json(msg)
            except Exception:
                self.disconnect(ws)
                return

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.pop(ws, None)

    def set_role(self, ws: WebSocket, role: str) -> None:
        if ws in self.clients:
            self.clients[ws] = role

    async def broadcast(self, msg: dict[str, Any]) -> None:
        msg_type = msg.get("type")
        if isinstance(msg_type, str):
            self.latest[msg_type] = msg
        dead: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
