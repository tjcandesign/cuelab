"""Drill mode: project a drill's balls as ghosts + targets, count attempts,
auto-score via successCriteria when determinable; manual mark always works."""

from __future__ import annotations

import math
from typing import Any

from ..engine.base import Ball
from .base import ActionError, BaseMode


class DrillMode(BaseMode):
    mode = "drill"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        drill = self.drill or {}
        self.layout = [
            {"ballId": b["id"], "x": float(b["x"]), "y": float(b["y"])}
            for b in drill.get("balls", [])
            if "id" in b and "x" in b and "y" in b
        ]
        self.targets: list[dict[str, Any]] = drill.get("targets") or []
        if self.targets:
            self.target = self.targets[0]
        self.called_pocket = drill.get("calledPocket")
        self.attempt_count = 0
        self._order = [p["id"] for p in self.players]
        self._idx = 0
        self._placing_matched = False
        self._last_attempt_id: int | None = None
        self._phase_task = None

    async def start(self) -> None:
        self.phase = "placing" if self.layout else "live"
        if self._order:
            self.current_player_id = self._order[0]

    # -------------------------------------------------------------- actions

    async def action(self, name: str, params: dict[str, Any]) -> None:
        if name == "end":
            await self.finish()
        elif name == "mark":
            self._do_mark(bool(params.get("success")))
        elif name == "next":
            await self._do_next()
        else:
            raise ActionError(f"unknown action {name!r} for drill")

    def _do_mark(self, success: bool) -> None:
        if self._last_attempt_id is None:
            raise ActionError("no attempt to mark yet")
        row = self.mgr.db.query_one(
            "SELECT id, player_id, points FROM attempts WHERE id=?",
            (self._last_attempt_id,),
        )
        if row is None:
            raise ActionError("attempt not found")
        new_points = 1 if success else 0
        delta = new_points - row["points"]
        self.mgr.db.execute(
            "UPDATE attempts SET points=? WHERE id=?", (new_points, row["id"])
        )
        player = self.player(row["player_id"])
        if player is not None and delta:
            player["score"] += delta
            self.mgr.db.execute(
                "UPDATE session_players SET score=? WHERE session_id=? AND player_id=?",
                (player["score"], self.session_id, row["player_id"]),
            )
        if self.last_result:
            self.last_result["points"] = new_points
            self.last_result["success"] = success

    async def _do_next(self) -> None:
        self._cancel_timer()
        if self.phase == "placing":
            self.phase = "live"
        elif self.phase == "live":
            await self._record_shot({"ballsPocketed": [], "cueScratched": False})
        elif self.phase == "result":
            await self._advance()
        elif self.phase == "ended":
            pass

    # ----------------------------------------------------------- game logic

    async def on_state(self, balls: list[Ball]) -> None:
        if self.phase != "placing" or self._placing_matched:
            return
        if self.layout_matches(balls, self.layout):
            self._placing_matched = True
            await self.mgr.emit_ws_event(
                "layout_matched",
                {"sessionId": self.session_id, "playerId": self.current_player_id},
            )
            self.phase = "live"
            await self.mgr.push()

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if etype == "shot_end" and self.phase == "live":
            await self._record_shot(data)
            await self.mgr.push()

    def _evaluate(self, data: dict[str, Any]) -> tuple[bool | None, bool]:
        """Return (success|None if undeterminable, determinable)."""
        crit = (self.drill or {}).get("successCriteria") or {}
        must_pocket = crit.get("mustPocket") or []
        cue_in_target = bool(crit.get("cueInTarget"))
        determinable = bool(must_pocket) or cue_in_target
        if not determinable:
            return None, False
        pocketed_list = data.get("ballsPocketed") or []
        success = True
        if data.get("cueScratched"):
            success = False
        if must_pocket and success:
            if self.called_pocket:
                success = all(
                    any(
                        bp.get("ballId") == m and bp.get("pocket") == self.called_pocket
                        for bp in pocketed_list
                    )
                    for m in must_pocket
                )
            else:
                pocketed_ids = {bp.get("ballId") for bp in pocketed_list}
                success = set(must_pocket) <= pocketed_ids
        if cue_in_target and success and self.targets:
            engine = self.mgr.get_engine()
            cue = next((b for b in engine.balls() if b.id == "cue"), None)
            if cue is None:
                success = False
            else:
                tc = self.targets[0]["c"]
                max_r = max(self.targets[0].get("radii", [270.0]))
                success = math.hypot(cue.x - tc[0], cue.y - tc[1]) <= max_r
        return success, True

    async def _record_shot(self, data: dict[str, Any]) -> None:
        shooter_id = self.current_player_id
        if shooter_id is None:
            return
        success, determinable = self._evaluate(data)
        pocketed_list = data.get("ballsPocketed") or []
        scratch = bool(data.get("cueScratched"))
        points = 1 if success else 0
        player = self.player(shooter_id)
        if player is not None:
            player["shots"] += 1
        self._last_attempt_id = self.record_attempt(
            shooter_id, points, bool(pocketed_list), scratch, None
        )
        self.attempt_count += 1
        self.last_result = {
            "playerId": shooter_id,
            "points": points,
            "pocketed": bool(pocketed_list),
            "scratch": scratch,
            "ring": None,
            "success": success,
            "pendingMark": not determinable,
        }
        self.phase = "result"
        self._phase_task = self.mgr.schedule(self.mgr.timing.result, self._advance)

    async def _advance(self) -> None:
        if self.ended:
            return
        self.last_result = None
        if self._order:
            self._idx = (self._idx + 1) % len(self._order)
            self.current_player_id = self._order[self._idx]
            if self._idx == 0:
                if self.round >= self.total_rounds:
                    await self.finish()
                    return
                self.round += 1
        self.phase = "placing" if self.layout else "live"
        self._placing_matched = False
        await self.mgr.push()

    def _cancel_timer(self) -> None:
        if self._phase_task is not None and not self._phase_task.done():
            self._phase_task.cancel()
        self._phase_task = None

    # ------------------------------------------------------------- snapshot

    def message(self) -> str:
        name = self.player_name(self.current_player_id)
        drill_name = (self.drill or {}).get("name", "Drill")
        if self.phase == "placing":
            return f"{name}: set up '{drill_name}'"
        if self.phase == "live":
            return f"{name}: shoot!"
        if self.phase == "result" and self.last_result:
            if self.last_result.get("pendingMark"):
                return "Mark the attempt: success or miss"
            return "Success!" if self.last_result["points"] else "Missed"
        if self.phase == "ended":
            return "Drill complete"
        return drill_name

    def _extra(self) -> dict[str, Any]:
        drill = self.drill or {}
        return {
            "attempts": self.attempt_count,
            "drill": {"id": drill.get("id"), "name": drill.get("name")},
        }

    def scene(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for target in self.targets:
            items.append(
                {
                    "kind": "ring",
                    "c": target["c"],
                    "radii": target.get("radii", [90, 180, 270]),
                    "labels": [str(s) for s in target.get("scores", [])],
                    "color": "accent",
                }
            )
        items += self.scene_called_pocket()
        if self.phase == "placing":
            items += self.scene_ghosts(self.layout)
            items.append(
                self.scene_text("PLACE BALLS ON THE SPOTS", dy=-320, size=48)
            )
        elif self.phase == "result" and self.last_result:
            if self.last_result.get("pendingMark"):
                items.append(self.scene_text("MARK: SUCCESS OR MISS?", dy=-320))
            else:
                good = self.last_result["points"] > 0
                items.append(
                    self.scene_text(
                        "SUCCESS" if good else "MISS",
                        color="success" if good else "danger",
                        dy=-320,
                        size=90,
                    )
                )
        elif self.phase == "ended":
            items.append(self.scene_text("DRILL COMPLETE"))
        return items
