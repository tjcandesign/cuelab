"""Player CRUD + stats."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..game.stats import player_stats
from ..models import PlayerCreate, PlayerPatch
from ..state import CueLab
from .deps import get_cl

router = APIRouter()

PALETTE = [
    "#8b5cf6", "#34d399", "#f87171", "#60a5fa",
    "#fbbf24", "#f472b6", "#2dd4bf", "#fb923c",
]


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "initials": row["initials"],
        "color": row["color"],
        "createdAt": row["created_at"],
        "lastActive": row["last_active"],
    }


def _default_initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


@router.get("/players")
async def list_players(cl: CueLab = Depends(get_cl)) -> list[dict[str, Any]]:
    return [_row_to_dict(r) for r in cl.db.query("SELECT * FROM players ORDER BY id")]


@router.post("/players", status_code=201)
async def create_player(
    body: PlayerCreate, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    count = cl.db.query_one("SELECT COUNT(*) AS n FROM players")
    color = body.color or PALETTE[(count["n"] if count else 0) % len(PALETTE)]
    initials = body.initials or _default_initials(body.name)
    player_id = cl.db.execute(
        "INSERT INTO players (name, initials, color) VALUES (?, ?, ?)",
        (body.name, initials, color),
    )
    row = cl.db.query_one("SELECT * FROM players WHERE id=?", (player_id,))
    assert row is not None
    return _row_to_dict(row)


@router.get("/players/{player_id}")
async def get_player(player_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT * FROM players WHERE id=?", (player_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="player not found")
    return _row_to_dict(row)


@router.patch("/players/{player_id}")
async def patch_player(
    player_id: int, body: PlayerPatch, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    row = cl.db.query_one("SELECT * FROM players WHERE id=?", (player_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="player not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        sets = ", ".join(f"{k}=?" for k in updates)
        cl.db.execute(
            f"UPDATE players SET {sets} WHERE id=?",
            (*updates.values(), player_id),
        )
    row = cl.db.query_one("SELECT * FROM players WHERE id=?", (player_id,))
    assert row is not None
    return _row_to_dict(row)


@router.delete("/players/{player_id}")
async def delete_player(player_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT id FROM players WHERE id=?", (player_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="player not found")
    cl.db.execute("DELETE FROM players WHERE id=?", (player_id,))
    return {"ok": True}


@router.get("/players/{player_id}/stats")
async def get_player_stats(
    player_id: int, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    row = cl.db.query_one("SELECT id FROM players WHERE id=?", (player_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="player not found")
    return player_stats(cl.db, player_id)
