"""Calibration endpoints: camera homography solve/store/preview, projector
corner store, and projection<->camera verification."""

from __future__ import annotations

import asyncio
import math
import random
from typing import Any

import cv2
import numpy as np

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..calibration import apply_homography
from ..models import CalibrationCameraBody, CalibrationProjectorBody
from ..render import encode_jpeg, warp_with_homography
from ..state import CueLab
from .deps import get_cl

router = APIRouter()

VERIFY_MARKERS_MM = [(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)]


@router.get("/calibration")
async def get_calibration(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    return cl.calibration.to_dict()


@router.post("/calibration/camera")
async def solve_camera(
    body: CalibrationCameraBody, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    try:
        H = cl.calibration.solve_camera(
            body.points, cl.config.tableL, cl.config.tableW
        )
    except cv2.error as exc:
        raise HTTPException(status_code=422, detail=f"degenerate corners: {exc}") from exc
    cl.on_camera_calibrated()
    return {"H": H}


@router.get("/calibration/camera/preview.jpg")
async def camera_preview(cl: CueLab = Depends(get_cl)) -> Response:
    H = cl.calibration.homography()
    if H is None:
        raise HTTPException(status_code=409, detail="camera not calibrated yet")
    frame = cl.camera_frame()
    warped = warp_with_homography(frame, H, cl.config.tableL, cl.config.tableW)
    return Response(content=encode_jpeg(warped), media_type="image/jpeg")


@router.post("/calibration/projector")
async def set_projector(
    body: CalibrationProjectorBody, cl: CueLab = Depends(get_cl)
) -> dict[str, Any]:
    cl.calibration.set_projector(body.corners)
    return cl.calibration.to_dict()


@router.post("/calibration/verify")
async def verify(cl: CueLab = Depends(get_cl)) -> dict[str, Any]:
    if cl.config.mode == "sim":
        errors = [round(random.uniform(0.3, 1.6), 2) for _ in VERIFY_MARKERS_MM]
        return {
            "ok": True,
            "errorsMm": errors,
            "note": "simulated pass (sim mode: projector and camera share table space)",
        }
    H = cl.calibration.homography()
    if H is None:
        return {"ok": False, "errorsMm": None, "note": "camera not calibrated yet"}
    length, width = cl.config.tableL, cl.config.tableW
    markers = [(fx * length, fy * width) for fx, fy in VERIFY_MARKERS_MM]
    try:
        # project bright markers through the scene channel
        items = [
            {"kind": "ring", "c": [x, y], "radii": [40.0], "labels": [], "color": "white"}
            for x, y in markers
        ]
        await cl.hub.broadcast({"type": "scene", "items": items})
        await asyncio.sleep(0.6)  # let the projector page render + camera settle
        frame = cl.engine.camera_frame()
        if frame is None:
            return {"ok": False, "errorsMm": None, "note": "no camera frame available"}
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY)
        n, _labels, stats, centroids = cv2.connectedComponentsWithStats(thresh, 8)
        blobs_mm = []
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 30:
                continue
            cx, cy = centroids[i]
            blobs_mm.append(apply_homography(H, float(cx), float(cy)))
        if not blobs_mm:
            return {
                "ok": False,
                "errorsMm": None,
                "note": "no bright markers detected by the camera",
            }
        errors = []
        for mx, my in markers:
            best = min(
                math.hypot(bx - mx, by - my) for bx, by in blobs_mm
            )
            errors.append(round(best, 1))
        ok = all(e < 25.0 for e in errors)
        note = "verified against projected markers" if ok else "offsets exceed 25 mm"
        return {"ok": ok, "errorsMm": errors, "note": note}
    except Exception as exc:
        return {"ok": False, "errorsMm": None, "note": f"verify failed: {exc}"}
    finally:
        # restore the game scene
        await cl.game.refresh_scene()
