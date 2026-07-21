"""Recording endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.post("/recording/start")
async def start_recording(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    try:
        return cl.recorder.start()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/recording/stop")
async def stop_recording(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    try:
        return await cl.recorder.stop()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/recordings")
async def list_recordings(cl: CueLab = Depends(get_cl)) -> list[dict[str, Any]]:
    return cl.recorder.list_recordings()
