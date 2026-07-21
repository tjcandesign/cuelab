"""Vision engine: real overhead camera -> homography warp -> classical
detection -> tracking. Starts cleanly with no camera attached (logs a
warning and emits nothing; never crashes the server)."""

from __future__ import annotations

import asyncio
import logging
import math
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from ..render import RASTER_SCALE, warp_with_homography
from .base import (
    Ball,
    Engine,
    EngineSink,
    ball_color,
    ball_kind,
    pocket_map,
)
from .detector import BallDetector, ClassicalDetector, Detection

log = logging.getLogger("cuelab.vision")

SETTLE_SPEED = 5.0
SHOT_SPEED = 100.0
EMA_ALPHA = 0.5
MAX_ASSIGN_MM = 120.0  # nearest-neighbor gate per frame
GONE_FRAMES = 5  # frames missing before a ball is declared gone
NEW_FRAMES = 5  # frames present before a ball is declared added
POCKET_NEAR_MM = 110.0


@dataclass
class _Track:
    id: str
    number: int
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    missing: int = 0
    seen: int = 0
    last_seen_xy: tuple[float, float] = (0.0, 0.0)


@dataclass
class _Candidate:
    number: int
    x: float
    y: float
    frames: int = 1


class VisionEngine(Engine):
    mode = "camera"

    def __init__(
        self,
        table_l: float,
        table_w: float,
        source: int | str,
        sink: EngineSink | None = None,
        homography: np.ndarray | None = None,
        detector: BallDetector | None = None,
        undistort: tuple[np.ndarray, np.ndarray] | None = None,
    ) -> None:
        super().__init__(sink)
        self.table_l = table_l
        self.table_w = table_w
        self.source = source
        self.H = homography
        self.detector: BallDetector = detector or ClassicalDetector()
        self.undistort = undistort  # (camera_matrix, dist_coeffs) or None
        self.pockets = pocket_map(table_l, table_w)
        self._tracks: dict[str, _Track] = {}
        self._candidates: dict[str, _Candidate] = {}
        self._frame: np.ndarray | None = None
        self._frame_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._moving = False
        self._shot_started_at = 0.0
        self._shot_pocketed: list[dict[str, str]] = []
        self._shot_scratched = False
        self._last_emit = 0.0

    # ---------------------------------------------------------------- engine

    def set_homography(self, H: np.ndarray | None) -> None:
        self.H = H

    def balls(self) -> list[Ball]:
        out = []
        for t in sorted(self._tracks.values(), key=lambda t: t.number):
            speed = math.hypot(t.vx, t.vy)
            out.append(
                Ball(
                    id=t.id,
                    number=t.number,
                    kind=ball_kind(t.number) if t.number >= 0 else "unknown",
                    x=t.x,
                    y=t.y,
                    vx=t.vx,
                    vy=t.vy,
                    settled=speed < SETTLE_SPEED,
                    color=ball_color(t.number) if t.number >= 0 else "#8b8b98",
                )
            )
        return out

    def camera_frame(self) -> np.ndarray | None:
        with self._frame_lock:
            return None if self._frame is None else self._frame.copy()

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._capture_loop, name="vision-capture", daemon=True
        )
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None

    # --------------------------------------------------------------- capture

    def _capture_loop(self) -> None:
        try:
            cap = cv2.VideoCapture(self.source)
        except Exception as exc:  # pragma: no cover - driver dependent
            log.warning("camera open failed (%s); vision engine idle", exc)
            return
        if not cap.isOpened():
            log.warning(
                "no camera at source %r; vision engine running idle "
                "(no frames, no events)",
                self.source,
            )
            cap.release()
            return
        log.info("camera opened: %r", self.source)
        prev_time = time.monotonic()
        try:
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    time.sleep(0.05)
                    continue
                now = time.monotonic()
                dt = max(now - prev_time, 1e-3)
                prev_time = now
                with self._frame_lock:
                    self._frame = frame
                try:
                    self._process(frame, dt, now)
                except Exception:
                    log.exception("frame processing failed")
        finally:
            cap.release()

    def _process(self, frame: np.ndarray, dt: float, now: float) -> None:
        if self.H is None:
            return  # not calibrated yet: keep serving raw frames only
        if self.undistort is not None:
            camera_matrix, dist = self.undistort
            frame = cv2.undistort(frame, camera_matrix, dist)
        raster = warp_with_homography(frame, self.H, self.table_l, self.table_w)
        detections = self.detector.detect(raster, RASTER_SCALE)
        events = self._update_tracks(detections, dt)
        self._detect_shot(events, now)
        balls = self.balls()
        moving = self._moving
        emit_state = False
        interval = (1 / 30) if moving else (1 / 4)
        if now - self._last_emit >= interval:
            self._last_emit = now
            emit_state = True
        if self._loop is not None and self.sink is not None:
            sink = self.sink
            loop = self._loop

            async def dispatch() -> None:
                for etype, data in events:
                    await sink.on_event(etype, data)
                if emit_state:
                    await sink.on_state(balls, moving)

            asyncio.run_coroutine_threadsafe(dispatch(), loop)

    # -------------------------------------------------------------- tracking

    def _update_tracks(
        self, detections: list[Detection], dt: float
    ) -> list[tuple[str, dict[str, Any]]]:
        events: list[tuple[str, dict[str, Any]]] = []
        unmatched = list(detections)
        # nearest-neighbor assignment, greedy by distance
        pairs: list[tuple[float, _Track, Detection]] = []
        for track in self._tracks.values():
            for det in detections:
                d = math.hypot(det.x - track.x, det.y - track.y)
                if d <= MAX_ASSIGN_MM:
                    pairs.append((d, track, det))
        pairs.sort(key=lambda p: p[0])
        used_tracks: set[str] = set()
        used_dets: set[int] = set()
        for d, track, det in pairs:
            if track.id in used_tracks or id(det) in used_dets:
                continue
            used_tracks.add(track.id)
            used_dets.add(id(det))
            if det in unmatched:
                unmatched.remove(det)
            new_x = track.x + EMA_ALPHA * (det.x - track.x)
            new_y = track.y + EMA_ALPHA * (det.y - track.y)
            track.vx = (new_x - track.x) / dt
            track.vy = (new_y - track.y) / dt
            track.x, track.y = new_x, new_y
            track.last_seen_xy = (new_x, new_y)
            track.missing = 0
            track.seen += 1

        for track in list(self._tracks.values()):
            if track.id in used_tracks:
                continue
            track.missing += 1
            track.vx = track.vy = 0.0
            if track.missing >= GONE_FRAMES:
                del self._tracks[track.id]
                pocket = self._nearest_pocket(*track.last_seen_xy)
                if pocket is not None:
                    if track.id == "cue":
                        events.append(("scratch", {"pocket": pocket}))
                        if self._moving:
                            self._shot_scratched = True
                    else:
                        events.append(
                            ("ball_pocketed", {"ballId": track.id, "pocket": pocket})
                        )
                        if self._moving:
                            self._shot_pocketed.append(
                                {"ballId": track.id, "pocket": pocket}
                            )
                else:
                    events.append(("ball_removed", {"ballId": track.id}))

        # new detections must persist NEW_FRAMES frames before becoming tracks
        still_candidates: dict[str, _Candidate] = {}
        for det in unmatched:
            key = None
            for ckey, cand in self._candidates.items():
                if math.hypot(det.x - cand.x, det.y - cand.y) <= MAX_ASSIGN_MM:
                    key = ckey
                    break
            if key is None:
                key = f"cand_{det.number}_{int(det.x)}_{int(det.y)}"
                still_candidates[key] = _Candidate(det.number, det.x, det.y)
                continue
            cand = self._candidates[key]
            cand.frames += 1
            cand.x, cand.y = det.x, det.y
            cand.number = det.number
            if cand.frames >= NEW_FRAMES:
                ball_id = self._id_for_number(cand.number)
                if ball_id is not None and ball_id not in self._tracks:
                    self._tracks[ball_id] = _Track(
                        id=ball_id,
                        number=cand.number,
                        x=cand.x,
                        y=cand.y,
                        last_seen_xy=(cand.x, cand.y),
                        seen=cand.frames,
                    )
                    events.append(("ball_added", {"ballId": ball_id}))
            else:
                still_candidates[key] = cand
        self._candidates = still_candidates
        return events

    def _id_for_number(self, number: int) -> str | None:
        if number == 0:
            return "cue"
        if 1 <= number <= 15:
            return f"b{number}"
        # unknown color: give it a free unknown slot
        for i in range(1, 16):
            if f"b{i}" not in self._tracks:
                return f"b{i}"
        return None

    def _nearest_pocket(self, x: float, y: float) -> str | None:
        best_id, best_d = None, POCKET_NEAR_MM
        for pid, (px, py, _cap) in self.pockets.items():
            d = math.hypot(x - px, y - py)
            if d <= best_d:
                best_id, best_d = pid, d
        return best_id

    def _detect_shot(
        self, events: list[tuple[str, dict[str, Any]]], now: float
    ) -> None:
        speeds = [math.hypot(t.vx, t.vy) for t in self._tracks.values()]
        if not self._moving:
            if any(sp > SHOT_SPEED for sp in speeds):
                self._moving = True
                self._shot_started_at = now
                self._shot_pocketed = []
                self._shot_scratched = False
                events.append(("shot_start", {"ballId": None}))
        else:
            if all(sp < SETTLE_SPEED for sp in speeds):
                self._moving = False
                events.append(
                    (
                        "shot_end",
                        {
                            "durationMs": int((now - self._shot_started_at) * 1000),
                            "ballsPocketed": list(self._shot_pocketed),
                            "cueScratched": self._shot_scratched,
                        },
                    )
                )
                events.append(("balls_settled", {}))
