"""Voice coach endpoint. Sync handler so the blocking Anthropic call runs
in FastAPI's threadpool without stalling the engine loop."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from .. import voice
from ..state import CueLab
from ..models import VoiceBody
from .deps import get_cl

log = logging.getLogger("cuelab.voice")

router = APIRouter()


@router.post("/voice/chat")
def voice_chat(body: VoiceBody, cl: CueLab = Depends(get_cl)) -> JSONResponse:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return JSONResponse(
            status_code=501,
            content={
                "reply": None,
                "error": "Set ANTHROPIC_API_KEY to enable the voice coach",
            },
        )
    try:
        snapshot = cl.game.snapshot()
        reply = voice.chat(body.text, snapshot)
        return JSONResponse(content={"reply": reply})
    except Exception as exc:
        log.exception("voice chat failed")
        return JSONResponse(
            status_code=502, content={"reply": None, "error": str(exc)}
        )
