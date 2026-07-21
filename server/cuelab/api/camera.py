"""Camera frame endpoints: snapshot + MJPEG stream (synthetic in sim)."""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse

from ..render import encode_jpeg
from ..state import CueLab
from .deps import get_cl

router = APIRouter()


@router.get("/camera/snapshot.jpg")
async def snapshot(cl: CueLab = Depends(get_cl)) -> Response:
    jpg = encode_jpeg(cl.camera_frame())
    return Response(content=jpg, media_type="image/jpeg")


@router.get("/camera/mjpeg")
async def mjpeg(cl: CueLab = Depends(get_cl)) -> StreamingResponse:
    async def stream() -> AsyncIterator[bytes]:
        while True:
            jpg = encode_jpeg(cl.camera_frame())
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(jpg)).encode()
                + b"\r\n\r\n"
                + jpg
                + b"\r\n"
            )
            await asyncio.sleep(0.1)

    return StreamingResponse(
        stream(), media_type="multipart/x-mixed-replace; boundary=frame"
    )
