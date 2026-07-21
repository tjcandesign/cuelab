"""REST API routers (all mounted under /api)."""

from __future__ import annotations

from fastapi import APIRouter

from . import (
    calibration,
    camera,
    drills,
    players,
    recording,
    sessions,
    sim,
    stats,
    system,
    voice,
)

router = APIRouter(prefix="/api")
router.include_router(system.router)
router.include_router(camera.router)
router.include_router(calibration.router)
router.include_router(players.router)
router.include_router(drills.router)
router.include_router(sessions.router)
router.include_router(sim.router)
router.include_router(recording.router)
router.include_router(voice.router)
router.include_router(stats.router)
