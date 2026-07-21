"""App wiring: config + db + hub + engine + game manager + recorder."""

from __future__ import annotations

import logging
import time
from typing import Any

import numpy as np

from . import config as cfg
from .calibration import CalibrationStore
from .db import Database
from .engine.base import Ball, Engine
from .engine.sim import SimEngine
from .engine.vision import VisionEngine
from .game.manager import GameManager, Timing
from .hub import Hub
from .recording import Recorder
from .render import placeholder_frame

log = logging.getLogger("cuelab")


class Dispatcher:
    """Engine sink: fan state/events out to the WebSocket hub, the event
    log, and the game layer."""

    def __init__(self, cl: "CueLab") -> None:
        self.cl = cl

    async def on_state(self, balls: list[Ball], moving: bool) -> None:
        msg = {
            "type": "state",
            "ts": int(time.time() * 1000),
            "moving": moving,
            "balls": [b.to_dict() for b in balls],
        }
        await self.cl.hub.broadcast(msg)
        await self.cl.game.on_state(balls)

    async def on_event(self, event_type: str, data: dict[str, Any]) -> None:
        self.cl.db.log_event(event_type, data)
        await self.cl.hub.broadcast(
            {"type": "event", "event": event_type, "data": data}
        )
        await self.cl.game.on_event(event_type, data)


class CueLab:
    def __init__(self) -> None:
        self.data_dir = cfg.data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config = cfg.load_config(cfg.config_path())
        cfg.save_config(self.config, cfg.config_path())
        self.calibration = CalibrationStore(self.data_dir / "calibration.json")
        self.db = Database(self.data_dir / "cuelab.db")
        self.hub = Hub()
        self.game = GameManager(
            self.db,
            self.hub,
            get_engine=lambda: self.engine,
            table_dims=lambda: (self.config.tableL, self.config.tableW),
            timing=Timing.from_env(),
        )
        self.dispatcher = Dispatcher(self)
        self.engine: Engine = self._build_engine()
        self.recorder = Recorder(self)

    # --------------------------------------------------------------- engine

    def _build_engine(self) -> Engine:
        if self.config.mode == "camera":
            log.info("engine: camera (source=%r)", self.config.camera.source)
            return VisionEngine(
                self.config.tableL,
                self.config.tableW,
                source=self.config.camera.source,
                sink=self.dispatcher,
                homography=self.calibration.homography(),
            )
        log.info("engine: sim (%.0fx%.0f mm)", self.config.tableL, self.config.tableW)
        return SimEngine(self.config.tableL, self.config.tableW, sink=self.dispatcher)

    async def start(self) -> None:
        await self.engine.start()

    async def stop(self) -> None:
        if self.recorder.active:
            try:
                await self.recorder.stop()
            except Exception:
                pass
        self.game.cancel_tasks()
        await self.engine.stop()
        self.db.close()

    async def apply_config(self, patch: dict[str, Any]) -> None:
        old = self.config
        self.config = cfg.merge_config(old, patch)
        cfg.save_config(self.config, cfg.config_path())
        engine_keys = ("mode", "camera", "tableL", "tableW", "tableSize")
        if any(k in patch for k in engine_keys):
            await self.engine.stop()
            self.engine = self._build_engine()
            await self.engine.start()

    def camera_frame(self) -> np.ndarray:
        frame = self.engine.camera_frame()
        if frame is None:
            return placeholder_frame("NO CAMERA SIGNAL")
        return frame

    def on_camera_calibrated(self) -> None:
        if isinstance(self.engine, VisionEngine):
            self.engine.set_homography(self.calibration.homography())
