"""Sim engine controls (only valid while mode=sim)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..engine.sim import SimEngine
from ..models import (
    SimAddBody,
    SimPlaceBody,
    SimRemoveBody,
    SimResetBody,
    SimShootBody,
)
from ..state import CueLab
from .deps import get_cl

router = APIRouter()


def _sim(cl: CueLab) -> SimEngine:
    engine = cl.engine
    if not isinstance(engine, SimEngine):
        raise HTTPException(
            status_code=409, detail="sim controls require mode=sim (see /api/config)"
        )
    return engine


@router.post("/sim/reset")
async def sim_reset(body: SimResetBody, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    engine = _sim(cl)
    balls = (
        [b.model_dump() for b in body.balls] if body.balls is not None else None
    )
    engine.reset(balls)
    return {"ok": True, "balls": [b.to_dict() for b in engine.balls()]}


@router.post("/sim/place")
async def sim_place(body: SimPlaceBody, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    engine = _sim(cl)
    try:
        engine.place(body.id, body.x, body.y)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/sim/shoot")
async def sim_shoot(body: SimShootBody, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    engine = _sim(cl)
    try:
        engine.shoot(body.ballId, body.angle, body.speed)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"ball {body.ballId!r} not on the table"
        ) from exc
    return {"ok": True}


@router.post("/sim/add")
async def sim_add(body: SimAddBody, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    engine = _sim(cl)
    engine.add(body.id)
    return {"ok": True}


@router.post("/sim/remove")
async def sim_remove(body: SimRemoveBody, cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    engine = _sim(cl)
    try:
        engine.remove(body.id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"ball {body.id!r} not on the table"
        ) from exc
    return {"ok": True}
