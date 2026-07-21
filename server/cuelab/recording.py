"""Recording: mp4 capture of the current camera frame (synthetic in sim)
with a small scoreboard overlay, ~15 fps."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np

if TYPE_CHECKING:
    from .state import CueLab

log = logging.getLogger("cuelab.recording")

FPS = 15.0


class Recorder:
    def __init__(self, cl: "CueLab") -> None:
        self.cl = cl
        self.dir = cl.data_dir / "recordings"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._writer: cv2.VideoWriter | None = None
        self._task: asyncio.Task | None = None
        self._path: Path | None = None
        self._size: tuple[int, int] | None = None

    @property
    def active(self) -> bool:
        return self._task is not None

    def start(self) -> dict[str, Any]:
        if self.active:
            raise RuntimeError("recording already in progress")
        name = time.strftime("rec_%Y%m%d_%H%M%S.mp4")
        self._path = self.dir / name
        self._writer = None  # opened lazily on the first frame
        self._task = asyncio.create_task(self._run(), name="recorder")
        return {"file": name, "recording": True}

    async def stop(self) -> dict[str, Any]:
        if not self.active:
            raise RuntimeError("no recording in progress")
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if self._writer is not None:
            self._writer.release()
            self._writer = None
        path = self._path
        self._path = None
        return {"file": path.name if path else None}

    def list_recordings(self) -> list[dict[str, Any]]:
        out = []
        for p in sorted(self.dir.glob("*.mp4"), reverse=True):
            stat = p.stat()
            out.append(
                {
                    "file": p.name,
                    "sizeBytes": stat.st_size,
                    "createdAt": time.strftime(
                        "%Y-%m-%dT%H:%M:%S", time.localtime(stat.st_mtime)
                    ),
                }
            )
        return out

    async def _run(self) -> None:
        interval = 1.0 / FPS
        while True:
            started = time.monotonic()
            try:
                frame = self.cl.camera_frame()
                frame = self._overlay(frame)
                if self._writer is None:
                    h, w = frame.shape[:2]
                    self._size = (w, h)
                    self._writer = self._open_writer(w, h)
                if self._size is not None:
                    w, h = self._size
                    if frame.shape[1] != w or frame.shape[0] != h:
                        frame = cv2.resize(frame, (w, h))
                if self._writer is not None:
                    self._writer.write(frame)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("recording frame failed")
            elapsed = time.monotonic() - started
            await asyncio.sleep(max(0.0, interval - elapsed))

    def _open_writer(self, w: int, h: int) -> cv2.VideoWriter:
        assert self._path is not None
        for fourcc_name in ("avc1", "mp4v"):
            fourcc = cv2.VideoWriter_fourcc(*fourcc_name)
            writer = cv2.VideoWriter(str(self._path), fourcc, FPS, (w, h))
            if writer.isOpened():
                log.info("recording %s (%s)", self._path.name, fourcc_name)
                return writer
            writer.release()
        raise RuntimeError("no usable mp4 codec (tried avc1, mp4v)")

    def _overlay(self, frame: np.ndarray) -> np.ndarray:
        frame = frame.copy()
        snap = self.cl.game.snapshot()
        label = "CueLab"
        if snap:
            players = snap.get("players") or []
            if players:
                label = "  ".join(f"{p['initials'] or p['name']} {p['score']}" for p in players)
            label = f"{snap.get('mode', '')} R{snap.get('round', '')} | {label}"
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 34), (10, 10, 12), -1)
        cv2.putText(
            frame, label, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
            (230, 230, 235), 1, cv2.LINE_AA,
        )
        return frame
