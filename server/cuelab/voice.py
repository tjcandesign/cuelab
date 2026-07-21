"""Voice coach: Anthropic-backed pool coach grounded in the live game state.

anthropic is imported lazily so the server runs fine without the SDK
configured (returns HTTP 501 when ANTHROPIC_API_KEY is unset)."""

from __future__ import annotations

import json
import os
from typing import Any

PERSONA = (
    "You are CueLab's voice coach: a sharp, encouraging pool coach at the "
    "table with the player. Keep replies short (2-4 sentences), concrete, "
    "and conversational — they will be read aloud. Give practical advice "
    "about aim, speed, position play, and the current game situation. "
    "Never invent scores or state; use only the game summary provided."
)


def summarize_game(snapshot: dict[str, Any] | None) -> str:
    if not snapshot:
        return "No game is running right now; the table is in free practice."
    parts = [
        f"mode={snapshot.get('mode')}",
        f"phase={snapshot.get('phase')}",
        f"round={snapshot.get('round')}/{snapshot.get('totalRounds')}",
    ]
    players = snapshot.get("players") or []
    if players:
        scores = ", ".join(f"{p['name']}: {p['score']}" for p in players)
        parts.append(f"scores: {scores}")
    current = snapshot.get("currentPlayerId")
    for p in players:
        if p["id"] == current:
            parts.append(f"current player: {p['name']}")
    if snapshot.get("calledPocket"):
        parts.append(f"called pocket: {snapshot['calledPocket']}")
    if snapshot.get("lastResult"):
        parts.append(f"last result: {json.dumps(snapshot['lastResult'])}")
    if snapshot.get("extra"):
        parts.append(f"extra: {json.dumps(snapshot['extra'])}")
    return "Current game: " + "; ".join(parts)


def chat(text: str, snapshot: dict[str, Any] | None) -> str:
    """Blocking Anthropic call. Caller checks the API key first."""
    import anthropic  # lazy: server must run without it configured

    client = anthropic.Anthropic()
    system = PERSONA + "\n\n" + summarize_game(snapshot)
    response = client.messages.create(
        model=os.environ.get("CUELAB_LLM_MODEL", "claude-haiku-4-5"),
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": text}],
    )
    reply_parts = [
        block.text for block in response.content if getattr(block, "type", "") == "text"
    ]
    return "".join(reply_parts).strip()
