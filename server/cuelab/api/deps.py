"""Shared dependency: fetch the CueLab app state."""

from __future__ import annotations

from fastapi import Request

from ..state import CueLab


def get_cl(request: Request) -> CueLab:
    return request.app.state.cl
