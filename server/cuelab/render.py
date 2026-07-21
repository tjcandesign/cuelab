"""Rendering: top-down table raster + the synthetic perspective camera.

The synthetic camera makes the whole camera-calibration flow testable with
zero hardware: a fixed "mount" homography warps the top-down render into a
mildly perspective 1280x720 view, as if a real camera hung slightly
off-center above the table."""

from __future__ import annotations

import cv2
import numpy as np

from .engine.base import BALL_RADIUS, Ball, pocket_map

SYN_W, SYN_H = 1280, 720
TOPDOWN_SCALE = 0.45  # px per mm for the synthetic top-down draw
MARGIN_MM = 130.0  # wood rail margin around the playing surface
RASTER_SCALE = 2.0 / 3.0  # px per mm for calibrated top-down rasters

CLOTH_BGR = (201, 115, 34)  # #2273c9
RAIL_BGR = (52, 84, 128)  # wood brown
POCKET_BGR = (18, 18, 18)

# Where the playing-surface corners land in the synthetic 1280x720 camera
# view (tl, tr, br, bl) — mild trapezoid, camera slightly off-center.
_SYN_CORNERS = np.array(
    [[205.0, 150.0], [1085.0, 132.0], [1178.0, 624.0], [118.0, 655.0]],
    dtype=np.float32,
)


def _hex_to_bgr(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
    return (b, g, r)


def _topdown_corners_px(table_l: float, table_w: float) -> np.ndarray:
    s, m = TOPDOWN_SCALE, MARGIN_MM
    return np.array(
        [
            [m * s, m * s],
            [(m + table_l) * s, m * s],
            [(m + table_l) * s, (m + table_w) * s],
            [m * s, (m + table_w) * s],
        ],
        dtype=np.float32,
    )


def draw_topdown(
    balls: list[Ball], table_l: float, table_w: float
) -> np.ndarray:
    """Top-down BGR render of the table (rails + cloth + pockets + balls)."""
    s, m = TOPDOWN_SCALE, MARGIN_MM
    width = int(round((table_l + 2 * m) * s))
    height = int(round((table_w + 2 * m) * s))
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = RAIL_BGR
    x0, y0 = int(round(m * s)), int(round(m * s))
    x1, y1 = int(round((m + table_l) * s)), int(round((m + table_w) * s))
    cv2.rectangle(img, (x0, y0), (x1, y1), CLOTH_BGR, -1)

    for _pid, (px, py, cap) in pocket_map(table_l, table_w).items():
        cx, cy = int(round((m + px) * s)), int(round((m + py) * s))
        cv2.circle(img, (cx, cy), int(round(cap * 0.72 * s)), POCKET_BGR, -1)

    r_px = max(3, int(round(BALL_RADIUS * s)))
    for ball in balls:
        cx = int(round((m + ball.x) * s))
        cy = int(round((m + ball.y) * s))
        color = _hex_to_bgr(ball.color)
        cv2.circle(img, (cx, cy), r_px, color, -1)
        cv2.circle(img, (cx, cy), r_px, (25, 25, 25), 1)
        if ball.kind == "stripe":
            cv2.circle(img, (cx, cy), int(r_px * 0.5), (245, 245, 245), -1)
        elif ball.kind == "cue":
            cv2.circle(img, (cx, cy), int(r_px * 0.3), (215, 215, 215), -1)
    return img


def synthetic_homography(table_l: float, table_w: float) -> np.ndarray:
    """Homography mapping top-down render pixels -> synthetic camera pixels."""
    src = _topdown_corners_px(table_l, table_w)
    return cv2.getPerspectiveTransform(src, _SYN_CORNERS)


def synthetic_camera_view(
    balls: list[Ball], table_l: float, table_w: float
) -> np.ndarray:
    """The 1280x720 synthetic camera frame used in sim mode."""
    top = draw_topdown(balls, table_l, table_w)
    H = synthetic_homography(table_l, table_w)
    frame = cv2.warpPerspective(
        top, H, (SYN_W, SYN_H), flags=cv2.INTER_LINEAR, borderValue=(12, 12, 14)
    )
    return frame


def table_mm_to_synthetic_px(
    x_mm: float, y_mm: float, table_l: float, table_w: float
) -> tuple[float, float]:
    """Project a table-space point through the synthetic camera."""
    s, m = TOPDOWN_SCALE, MARGIN_MM
    H = synthetic_homography(table_l, table_w)
    px = np.array([(m + x_mm) * s, (m + y_mm) * s, 1.0])
    out = H @ px
    return float(out[0] / out[2]), float(out[1] / out[2])


def synthetic_table_corners(table_l: float, table_w: float) -> list[list[float]]:
    """Playing-surface corners (tl,tr,br,bl) in synthetic camera pixels —
    exactly what a user would click during calibration."""
    return [
        list(table_mm_to_synthetic_px(x, y, table_l, table_w))
        for x, y in [(0, 0), (table_l, 0), (table_l, table_w), (0, table_w)]
    ]


def warp_with_homography(
    frame: np.ndarray, H: np.ndarray, table_l: float, table_w: float
) -> np.ndarray:
    """Warp a camera frame to a top-down table raster with the stored
    camera->mm homography (RASTER_SCALE px per mm)."""
    s = RASTER_SCALE
    scale = np.array([[s, 0, 0], [0, s, 0], [0, 0, 1]], dtype=np.float64)
    M = scale @ H
    out_size = (int(round(table_l * s)), int(round(table_w * s)))
    return cv2.warpPerspective(frame, M, out_size, flags=cv2.INTER_LINEAR)


def placeholder_frame(text: str) -> np.ndarray:
    img = np.zeros((SYN_H, SYN_W, 3), dtype=np.uint8)
    img[:] = (14, 12, 12)
    cv2.putText(
        img, text, (60, SYN_H // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.4,
        (150, 150, 160), 2, cv2.LINE_AA,
    )
    return img


def encode_jpeg(frame: np.ndarray, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return bytes(buf.tobytes())
