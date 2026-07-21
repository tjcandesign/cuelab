"""Session lifecycle + game actions."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..game.base import ActionError
from ..models import SessionAction, SessionCreate
from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.post("/sessions", status_code=201)
async def create_session(
    body: SessionCreate, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    try:
        return await cl.game.create_session(
            body.mode, body.playerIds, body.rounds, body.drillId
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/sessions/{session_id}")
async def get_session(session_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    active = cl.game.active
    if active is not None and active.session_id == session_id:
        return active.snapshot()
    row = cl.db.query_one("SELECT * FROM sessions WHERE id=?", (session_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    players = cl.db.query(
        "SELECT p.id, p.name, p.initials, p.color, sp.score, sp.shots"
        " FROM session_players sp JOIN players p ON p.id = sp.player_id"
        " WHERE sp.session_id=?",
        (session_id,),
    )
    summary = json.loads(row["summary_json"]) if row["summary_json"] else {}
    return {
        "sessionId": row["id"],
        "mode": row["mode"],
        "phase": "ended",
        "round": summary.get("rounds"),
        "totalRounds": row["rounds"],
        "players": [dict(p) for p in players],
        "currentPlayerId": None,
        "setterId": None,
        "message": "Session complete",
        "countdown": None,
        "calledPocket": None,
        "target": None,
        "layout": [],
        "lastResult": None,
        "extra": {
            "startedAt": row["started_at"],
            "endedAt": row["ended_at"],
            "summary": summary,
        },
    }


@router.post("/sessions/{session_id}/action")
async def session_action(
    session_id: int, body: SessionAction, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    try:
        return await cl.game.action(session_id, body.action, body.params())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
