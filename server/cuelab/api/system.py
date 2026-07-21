"""Health + config endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import __version__
from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.get("/health")
async def health(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    return {"ok": True, "mode": cl.config.mode, "version": __version__}


@router.get("/config")
async def get_config(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    return cl.config.model_dump()


@router.put("/config")
async def put_config(
    patch: dict[str, Any] = Body(...), cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    try:
        await cl.apply_config(patch)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return cl.config.model_dump()
