"""Drill CRUD + import/export. Drill JSON is stored whole in the drills
table with name/type/published mirrored into columns."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from ..state import CueLab
from .deps import get_cl

router = APIRouter()


def _row_to_drill(row: Any) -> dict[str, Any]:
    drill = json.loads(row["json"])
    drill["id"] = row["id"]
    drill["name"] = row["name"]
    drill["type"] = row["type"]
    drill["published"] = bool(row["published"])
    return drill


def _validate(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict) or not body.get("name"):
        raise HTTPException(status_code=422, detail="drill needs a name")
    body.setdefault("type", "custom")
    body.setdefault("description", "")
    body.setdefault("table", "8ft")
    body.setdefault("balls", [])
    body.setdefault("targets", [])
    body.setdefault("tags", [])
    body.setdefault("published", False)
    return body


def _insert(cl: CueLab, drill: dict[str, Any]) -> dict[str, Any]:
    drill = _validate(dict(drill))
    drill.pop("id", None)
    drill_id = cl.db.execute(
        "INSERT INTO drills (name, type, published, json) VALUES (?, ?, ?, ?)",
        (drill["name"], drill["type"], 1 if drill["published"] else 0, json.dumps(drill)),
    )
    row = cl.db.query_one("SELECT * FROM drills WHERE id=?", (drill_id,))
    assert row is not None
    return _row_to_drill(row)


@router.get("/drills")
async def list_drills(cl: CueLab = Depends(get_cl)) -> list[dict[str, Any]]:
    return [_row_to_drill(r) for r in cl.db.query("SELECT * FROM drills ORDER BY id")]


@router.post("/drills", status_code=201)
async def create_drill(
    body: dict[str, Any] = Body(...), cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    return _insert(cl, body)


@router.get("/drills/{drill_id}")
async def get_drill(drill_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT * FROM drills WHERE id=?", (drill_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="drill not found")
    return _row_to_drill(row)


@router.put("/drills/{drill_id}")
async def update_drill(
    drill_id: int, body: dict[str, Any] = Body(...), cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    row = cl.db.query_one("SELECT id FROM drills WHERE id=?", (drill_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="drill not found")
    drill = _validate(dict(body))
    drill.pop("id", None)
    cl.db.execute(
        "UPDATE drills SET name=?, type=?, published=?, json=?,"
        " updated_at=datetime('now') WHERE id=?",
        (
            drill["name"],
            drill["type"],
            1 if drill["published"] else 0,
            json.dumps(drill),
            drill_id,
        ),
    )
    updated = cl.db.query_one("SELECT * FROM drills WHERE id=?", (drill_id,))
    assert updated is not None
    return _row_to_drill(updated)


@router.delete("/drills/{drill_id}")
async def delete_drill(drill_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT id FROM drills WHERE id=?", (drill_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="drill not found")
    cl.db.execute("DELETE FROM drills WHERE id=?", (drill_id,))
    return {"ok": True}


@router.post("/drills/import", status_code=201)
async def import_drills(
    body: dict[str, Any] | list[dict[str, Any]] = Body(...),
    cl: CueLab = Depends(get_cl),
) -> list[dict[str, Any]]:
    items = body if isinstance(body, list) else [body]
    return [_insert(cl, item) for item in items]


@router.get("/drills/{drill_id}/export")
async def export_drill(drill_id: int, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    row = cl.db.query_one("SELECT * FROM drills WHERE id=?", (drill_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="drill not found")
    return _row_to_drill(row)
