"""Aggregate stats."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..game.stats import overview
from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.get("/stats/overview")
async def stats_overview(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    return overview(cl.db)
