"""Pydantic request bodies for the REST API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Point = list[float]


class CalibrationCameraBody(BaseModel):
    points: list[Point] = Field(min_length=4, max_length=4)


class CalibrationProjectorBody(BaseModel):
    corners: list[Point] = Field(min_length=4, max_length=4)


class PlayerCreate(BaseModel):
    name: str
    initials: str | None = None
    color: str | None = None


class PlayerPatch(BaseModel):
    name: str | None = None
    initials: str | None = None
    color: str | None = None


class SessionCreate(BaseModel):
    mode: Literal["target_pool", "nine_ball", "drill", "free"]
    playerIds: list[int] = Field(default_factory=list)
    rounds: int = 10
    drillId: int | None = None


class SessionAction(BaseModel):
    model_config = ConfigDict(extra="allow")
    action: str

    def params(self) -> dict[str, Any]:
        return self.model_dump(exclude={"action"})


class SimBallSpec(BaseModel):
    id: str
    x: float
    y: float


class SimResetBody(BaseModel):
    balls: list[SimBallSpec] | None = None


class SimPlaceBody(BaseModel):
    id: str
    x: float | None = None
    y: float | None = None


class SimShootBody(BaseModel):
    ballId: str = "cue"
    angle: float
    speed: float


class SimAddBody(BaseModel):
    id: str


class SimRemoveBody(BaseModel):
    id: str


class VoiceBody(BaseModel):
    text: str
