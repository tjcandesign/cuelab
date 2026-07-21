"""App configuration, persisted to data/config.json."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

TABLE_PRESETS: dict[str, tuple[float, float]] = {
    "7ft": (1981.2, 990.6),
    "8ft": (2235.2, 1117.6),
    "9ft": (2540.0, 1270.0),
}


class CameraConfig(BaseModel):
    source: int | str = 0
    width: int = 1920
    height: int = 1080


class ProjectorConfig(BaseModel):
    width: int = 1920
    height: int = 1080


class AppConfig(BaseModel):
    mode: Literal["sim", "camera"] = "sim"
    tableSize: str = "8ft"
    tableL: float = TABLE_PRESETS["8ft"][0]
    tableW: float = TABLE_PRESETS["8ft"][1]
    camera: CameraConfig = Field(default_factory=CameraConfig)
    projector: ProjectorConfig = Field(default_factory=ProjectorConfig)


def data_dir() -> Path:
    """Resolve the persistent data directory (overridable for tests)."""
    return Path(os.environ.get("CUELAB_DATA_DIR", "data")).resolve()


def config_path() -> Path:
    return data_dir() / "config.json"


def load_config(path: Path) -> AppConfig:
    if path.exists():
        try:
            raw = json.loads(path.read_text())
            return AppConfig.model_validate(raw)
        except Exception:
            pass
    return AppConfig()


def save_config(cfg: AppConfig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg.model_dump(), indent=2))


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def merge_config(cfg: AppConfig, patch: dict[str, Any]) -> AppConfig:
    """Partial-merge a config patch. tableSize presets resolve tableL/tableW
    unless the patch overrides them explicitly (custom sizes allowed)."""
    merged = _deep_merge(cfg.model_dump(), patch)
    if "tableSize" in patch and patch["tableSize"] in TABLE_PRESETS:
        if "tableL" not in patch and "tableW" not in patch:
            length, width = TABLE_PRESETS[patch["tableSize"]]
            merged["tableL"] = length
            merged["tableW"] = width
    return AppConfig.model_validate(merged)


def time_scale() -> float:
    """Sim-time multiplier (testing knob, env CUELAB_TIME_SCALE)."""
    try:
        return max(0.01, float(os.environ.get("CUELAB_TIME_SCALE", "1")))
    except ValueError:
        return 1.0


def timer_scale() -> float:
    """Game-timer multiplier (testing knob, env CUELAB_TIMER_SCALE)."""
    try:
        return max(0.001, float(os.environ.get("CUELAB_TIMER_SCALE", "1")))
    except ValueError:
        return 1.0
