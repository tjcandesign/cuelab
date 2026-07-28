"""Recorded shot metrics (per session list + full record with paths)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.get("/sessions/{session_id}/shots")
async def list_session_shots(
    session_id: int, cl: CueLab = Depends(get_cl)
) -> list[dict[str, Any]]:
    if cl.db.query_one("SELECT id FROM sessions WHERE id=?", (session_id,)) is None:
        raise HTTPException(status_code=404, detail="session not found")
    rows = cl.db.query(
        "SELECT id, player_id, round, ts_start, ts_end, metrics_json"
        " FROM shots WHERE session_id=? ORDER BY id",
        (session_id,),
    )
    return [
        {
            "id": r["id"],
            "playerId": r["player_id"],
            "round": r["round"],
            "tsStart": r["ts_start"],
            "tsEnd": r["ts_end"],
            "metrics": json.loads(r["metrics_json"]),
        }
        for r in rows
    ]


@router.get("/shots/{shot_id}")
async def get_shot(shot_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT * FROM shots WHERE id=?", (shot_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="shot not found")
    return {
        "id": row["id"],
        "sessionId": row["session_id"],
        "playerId": row["player_id"],
        "round": row["round"],
        "tsStart": row["ts_start"],
        "tsEnd": row["ts_end"],
        "metrics": json.loads(row["metrics_json"]),
        "paths": json.loads(row["paths_json"]),
    }
