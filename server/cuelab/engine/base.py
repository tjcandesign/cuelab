"""Engine seam: abstract ball-state + event producer.

Both engines (sim and vision) push state frames and events through an
EngineSink; the app wires the sink to the WebSocket hub and game layer."""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

BALL_RADIUS = 28.575
BALL_DIAMETER = 57.15
POCKET_CAPTURE_CORNER = 85.0
POCKET_CAPTURE_SIDE = 75.0

# solids 1-7 hues; stripes n = base + 8
_BASE_COLORS: dict[int, str] = {
    1: "#fbbf24",  # yellow
    2: "#2563eb",  # blue
    3: "#ef4444",  # red
    4: "#8b5cf6",  # purple
    5: "#f97316",  # orange
    6: "#22c55e",  # green
    7: "#7f1d1d",  # maroon
}


def ball_number(ball_id: str) -> int:
    if ball_id == "cue":
        return 0
    if ball_id.startswith("b"):
        try:
            return int(ball_id[1:])
        except ValueError:
            return -1
    return -1


def ball_kind(number: int) -> str:
    if number == 0:
        return "cue"
    if number == 8:
        return "eight"
    if 1 <= number <= 7:
        return "solid"
    if 9 <= number <= 15:
        return "stripe"
    return "unknown"


def ball_color(number: int) -> str:
    if number == 0:
        return "#f2f2f2"
    if number == 8:
        return "#18181b"
    base = number if number <= 8 else number - 8
    return _BASE_COLORS.get(base, "#8b8b98")


def pocket_map(table_l: float, table_w: float) -> dict[str, tuple[float, float, float]]:
    """Pocket id -> (x, y, capture_radius)."""
    return {
        "tl": (0.0, 0.0, POCKET_CAPTURE_CORNER),
        "ts": (table_l / 2, 0.0, POCKET_CAPTURE_SIDE),
        "tr": (table_l, 0.0, POCKET_CAPTURE_CORNER),
        "bl": (0.0, table_w, POCKET_CAPTURE_CORNER),
        "bs": (table_l / 2, table_w, POCKET_CAPTURE_SIDE),
        "br": (table_l, table_w, POCKET_CAPTURE_CORNER),
    }


@dataclass
class Ball:
    id: str
    number: int
    kind: str
    x: float
    y: float
    vx: float
    vy: float
    settled: bool
    color: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "number": self.number,
            "kind": self.kind,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "vx": round(self.vx, 1),
            "vy": round(self.vy, 1),
            "settled": self.settled,
            "color": self.color,
        }


class EngineSink(Protocol):
    async def on_state(self, balls: list[Ball], moving: bool) -> None: ...

    async def on_event(self, event_type: str, data: dict[str, Any]) -> None: ...


class Engine(abc.ABC):
    """Abstract engine. Implementations own their update loop and push
    state + events through the sink."""

    mode: str = "base"

    def __init__(self, sink: EngineSink | None = None) -> None:
        self.sink = sink

    @abc.abstractmethod
    async def start(self) -> None: ...

    @abc.abstractmethod
    async def stop(self) -> None: ...

    @abc.abstractmethod
    def balls(self) -> list[Ball]: ...

    def camera_frame(self) -> np.ndarray | None:
        """Latest BGR camera frame (synthetic render in sim mode)."""
        return None
