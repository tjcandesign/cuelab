"""CueLab FastAPI app: REST under /api, WebSocket at /ws."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from . import __version__
from .api import router as api_router
from .state import CueLab

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
log = logging.getLogger("cuelab.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    cl = CueLab()
    app.state.cl = cl
    await cl.start()
    log.info("CueLab %s up (mode=%s)", __version__, cl.config.mode)
    try:
        yield
    finally:
        await cl.stop()
        log.info("CueLab stopped")


app = FastAPI(title="CueLab", version=__version__, lifespan=lifespan)
app.include_router(api_router)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    cl: CueLab = ws.app.state.cl
    await cl.hub.connect(ws)
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except (ValueError, KeyError):
                continue  # non-JSON frame: ignore
            if isinstance(msg, dict) and msg.get("type") == "hello":
                role = msg.get("role", "viewer")
                if role in ("control", "projector", "viewer"):
                    cl.hub.set_role(ws, role)
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass  # receive after disconnect
    finally:
        cl.hub.disconnect(ws)
