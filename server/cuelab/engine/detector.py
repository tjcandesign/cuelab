"""Ball detection on a top-down table raster.

Small interface so a learned model (ONNX / RF-DETR) can replace the
classical detector later without touching the vision engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from .base import BALL_DIAMETER


@dataclass
class Detection:
    x: float  # mm, table space
    y: float  # mm
    number: int  # 0=cue, -1=unknown
    kind: str
    color: str


class BallDetector(Protocol):
    def detect(self, raster_bgr: np.ndarray, px_per_mm: float) -> list[Detection]: ...


_HEX = {
    0: "#f2f2f2", 1: "#fbbf24", 2: "#2563eb", 3: "#ef4444", 4: "#8b5cf6",
    5: "#f97316", 6: "#22c55e", 7: "#7f1d1d", 8: "#18181b",
}


def _color_for(number: int) -> str:
    base = number - 8 if number > 8 else number
    return _HEX.get(base, "#8b8b98")


def _kind_for(number: int) -> str:
    if number == 0:
        return "cue"
    if number == 8:
        return "eight"
    if 1 <= number <= 7:
        return "solid"
    if 9 <= number <= 15:
        return "stripe"
    return "unknown"


class ClassicalDetector:
    """HSV cloth-distance segmentation -> connected components ->
    size/circularity filter -> hue-bucket color classification."""

    def __init__(self) -> None:
        self.cloth_hsv: np.ndarray | None = None  # mean HSV of the cloth

    def sample_cloth(self, raster_bgr: np.ndarray) -> None:
        h, w = raster_bgr.shape[:2]
        cy, cx = h // 2, w // 2
        patch = raster_bgr[
            max(0, cy - h // 8) : cy + h // 8, max(0, cx - w // 8) : cx + w // 8
        ]
        if patch.size == 0:
            return
        hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32)
        self.cloth_hsv = hsv.mean(axis=0)

    def _cloth_mask(self, hsv: np.ndarray) -> np.ndarray:
        assert self.cloth_hsv is not None
        ch, cs, cv_ = self.cloth_hsv
        h = hsv[:, :, 0].astype(np.int16)
        s = hsv[:, :, 1].astype(np.int16)
        v = hsv[:, :, 2].astype(np.int16)
        dh = np.minimum(np.abs(h - int(ch)), 180 - np.abs(h - int(ch)))
        dist = (
            (dh.astype(np.float32) * 2.5) ** 2
            + ((s - int(cs)).astype(np.float32) * 0.6) ** 2
            + ((v - int(cv_)).astype(np.float32) * 0.5) ** 2
        )
        return (dist < 5000.0).astype(np.uint8) * 255

    def detect(self, raster_bgr: np.ndarray, px_per_mm: float) -> list[Detection]:
        if raster_bgr is None or raster_bgr.size == 0:
            return []
        if self.cloth_hsv is None:
            self.sample_cloth(raster_bgr)
            if self.cloth_hsv is None:
                return []
        hsv = cv2.cvtColor(raster_bgr, cv2.COLOR_BGR2HSV)
        cloth = self._cloth_mask(hsv)
        mask = cv2.bitwise_not(cloth)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        ball_d_px = BALL_DIAMETER * px_per_mm
        expected_area = np.pi * (ball_d_px / 2) ** 2
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
        detections: list[Detection] = []
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if not (expected_area * 0.35 <= area <= expected_area * 2.5):
                continue
            w = stats[i, cv2.CC_STAT_WIDTH]
            h = stats[i, cv2.CC_STAT_HEIGHT]
            if max(w, h) > ball_d_px * 2.0 or min(w, h) < ball_d_px * 0.4:
                continue
            # circularity via the component's own contour
            x0, y0 = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP]
            blob = (labels[y0 : y0 + h, x0 : x0 + w] == i).astype(np.uint8)
            contours, _ = cv2.findContours(
                blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not contours:
                continue
            peri = cv2.arcLength(contours[0], True)
            if peri <= 0:
                continue
            circularity = 4 * np.pi * area / (peri * peri)
            if circularity < 0.55:
                continue
            cx, cy = centroids[i]
            number = self._classify(hsv, labels, i, x0, y0, w, h)
            detections.append(
                Detection(
                    x=float(cx / px_per_mm),
                    y=float(cy / px_per_mm),
                    number=number,
                    kind=_kind_for(number),
                    color=_color_for(number),
                )
            )
        return detections

    def _classify(
        self,
        hsv: np.ndarray,
        labels: np.ndarray,
        idx: int,
        x0: int,
        y0: int,
        w: int,
        h: int,
    ) -> int:
        region = hsv[y0 : y0 + h, x0 : x0 + w]
        blob = labels[y0 : y0 + h, x0 : x0 + w] == idx
        if not blob.any():
            return -1
        px = region[blob].astype(np.float32)  # N x (H,S,V)
        white = (px[:, 1] < 70) & (px[:, 2] > 170)
        white_frac = float(white.mean())
        if white_frac > 0.75:
            return 0  # cue: high V, low S nearly everywhere
        mean_v = float(px[:, 2].mean())
        if mean_v < 65:
            return 8  # black
        colored = px[~white] if (~white).any() else px
        hues = colored[:, 0]
        # circular-safe hue mode via histogram
        hist, _ = np.histogram(hues, bins=36, range=(0, 180))
        hue = (int(np.argmax(hist)) + 0.5) * 5.0
        v_col = float(colored[:, 2].mean())
        base = self._hue_bucket(hue, v_col)
        if base == -1:
            return -1
        if base != 0 and 0.2 <= white_frac <= 0.65:
            return base + 8  # stripe
        return base

    @staticmethod
    def _hue_bucket(hue: float, v: float) -> int:
        # OpenCV hue range 0-179
        if hue < 9 or hue >= 168:
            return 7 if v < 120 else 3  # maroon vs red
        if hue < 19:
            return 5  # orange
        if hue < 35:
            return 1  # yellow
        if hue < 88:
            return 6  # green
        if hue < 128:
            return 2  # blue
        if hue < 160:
            return 4  # purple
        return 3
