"""Camera/projector calibration storage and homography solving.

The camera homography H maps camera pixels -> table-space millimeters
(playing-surface origin top-left, +x along the long rail)."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


class CalibrationStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.camera_points: list[list[float]] | None = None
        self.camera_H: list[list[float]] | None = None
        self.projector_corners: list[list[float]] | None = None
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            cam = raw.get("camera") or {}
            self.camera_points = cam.get("points")
            self.camera_H = cam.get("H")
            proj = raw.get("projector") or {}
            self.projector_corners = proj.get("corners")
        except Exception:
            pass

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.to_dict(), indent=2))

    def to_dict(self) -> dict:
        return {
            "camera": {"points": self.camera_points, "H": self.camera_H},
            "projector": {"corners": self.projector_corners},
        }

    def solve_camera(
        self, points: list[list[float]], table_l: float, table_w: float
    ) -> list[list[float]]:
        """points: camera-pixel corners of the playing surface, order tl,tr,br,bl."""
        src = np.array(points, dtype=np.float32)
        dst = np.array(
            [[0.0, 0.0], [table_l, 0.0], [table_l, table_w], [0.0, table_w]],
            dtype=np.float32,
        )
        H = cv2.getPerspectiveTransform(src, dst)
        self.camera_points = [[float(x), float(y)] for x, y in points]
        self.camera_H = [[float(v) for v in row] for row in H]
        self._save()
        return self.camera_H

    def set_projector(self, corners: list[list[float]]) -> None:
        self.projector_corners = [[float(x), float(y)] for x, y in corners]
        self._save()

    def homography(self) -> np.ndarray | None:
        if self.camera_H is None:
            return None
        return np.array(self.camera_H, dtype=np.float64)


def apply_homography(H: np.ndarray, x: float, y: float) -> tuple[float, float]:
    pt = H @ np.array([x, y, 1.0])
    return float(pt[0] / pt[2]), float(pt[1] / pt[2])
