"""Instant Recall: single player memory/clearing game.

capturing (place balls, `capture` locks the settled layout as reference)
-> running (clear the table; each pocket +1 to the run; a settled shot
with no pocket, or any scratch, ends the run) -> restoring (ghosts for
EVERY reference ball; run resets to 0, re-place pocketed balls too;
layout match auto-resumes) -> cleared (best run = ball count) ->
capturing for a new layout. One attempts row per run, points = run length."""

from __future__ import annotations

from typing import Any

from ..engine.base import Ball
from .base import ActionError, BaseMode


class InstantRecallMode(BaseMode):
    mode = "instant_recall"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.ball_count = 0  # object balls in the reference layout
        self.current_run = 0
        self.best_run = 0
        self.attempt_count = 0
        self.cleared = False
        self.remaining: set[str] = set()  # object balls still on the table
        self._restoring_matched = False

    async def start(self) -> None:
        self._enter_capturing()

    def _enter_capturing(self) -> None:
        self.phase = "capturing"
        self.layout = []
        self.remaining = set()
        self.ball_count = 0
        self.current_run = 0
        self.cleared = False
        self.last_result = None

    # -------------------------------------------------------------- actions

    async def action(self, name: str, params: dict[str, Any]) -> None:
        if name == "end":
            await self.finish()
        elif name == "capture":
            self._do_capture()
        elif name == "mark":
            self._do_mark(bool(params.get("success")))
        elif name == "reset_layout":
            self._enter_capturing()
        elif name == "next":
            await self._do_next()
        else:
            raise ActionError(f"unknown action {name!r} for instant_recall")

    def _do_capture(self) -> None:
        if self.phase != "capturing":
            raise ActionError(f"capture not valid in phase {self.phase}")
        balls = [b for b in self.mgr.get_engine().balls() if b.settled]
        if len(balls) < 2:
            raise ActionError("place at least 2 balls on the table first")
        self.layout = [
            {"ballId": b.id, "x": round(b.x, 1), "y": round(b.y, 1)}
            for b in sorted(balls, key=lambda b: b.number)
        ]
        self.remaining = {b.id for b in balls if b.id != "cue"}
        self.ball_count = len(self.remaining)
        self.current_run = 0
        self.cleared = False
        self.phase = "running"

    def _do_mark(self, success: bool) -> None:
        """Manual override for the current run's outcome."""
        if self.phase not in ("running", "restoring"):
            raise ActionError(f"mark not valid in phase {self.phase}")
        if success:
            self._end_run_cleared()
        elif self.phase == "running":
            self._end_run_miss(scratch=False)
        # mark {success:false} while restoring is already a miss: no-op

    async def _do_next(self) -> None:
        if self.phase == "capturing":
            self._do_capture()
        elif self.phase == "running":
            self._end_run_miss(scratch=False)
        elif self.phase == "restoring":
            self._resume_running()
        elif self.phase == "cleared":
            self._enter_capturing()
        elif self.phase == "ended":
            pass

    # ----------------------------------------------------------- game logic

    async def on_event(self, etype: str, data: dict[str, Any]) -> None:
        if self.phase != "running":
            return
        if etype == "ball_pocketed":
            ball_id = str(data.get("ballId", ""))
            if ball_id in self.remaining:
                self.remaining.discard(ball_id)
                self.current_run += 1
                await self.mgr.push()
        elif etype == "shot_end":
            pocketed = [
                bp for bp in (data.get("ballsPocketed") or [])
                if bp.get("ballId") != "cue"
            ]
            scratch = bool(data.get("cueScratched"))
            player = self.player(self.current_player_id)
            if player is not None:
                player["shots"] += 1
            self.last_shot_made = bool(pocketed) and not scratch
            if scratch or not pocketed:
                self._end_run_miss(scratch)
            elif not self.remaining:
                self._end_run_cleared()
            await self.mgr.push()

    async def on_state(self, balls: list[Ball]) -> None:
        if self.phase != "restoring" or self._restoring_matched:
            return
        if self.layout_matches(balls, self.layout):
            self._restoring_matched = True
            await self.mgr.emit_ws_event(
                "layout_matched",
                {"sessionId": self.session_id, "playerId": self.current_player_id},
            )
            self._resume_running()
            await self.mgr.push()

    def _end_run_miss(self, scratch: bool) -> None:
        self.best_run = max(self.best_run, self.current_run)
        self.attempt_count += 1
        self._record_run(self.current_run, scratch)
        self.last_result = {
            "playerId": self.current_player_id,
            "points": self.current_run,
            "pocketed": self.current_run > 0,
            "scratch": scratch,
            "ring": None,
        }
        # the whole reference layout must go back, pocketed balls included
        self.current_run = 0
        self.remaining = {e["ballId"] for e in self.layout if e["ballId"] != "cue"}
        self._restoring_matched = False
        self.phase = "restoring"

    def _end_run_cleared(self) -> None:
        self.current_run = self.ball_count
        self.best_run = max(self.best_run, self.ball_count)
        self.attempt_count += 1
        self.cleared = True
        self._record_run(self.ball_count, scratch=False)
        self.last_result = {
            "playerId": self.current_player_id,
            "points": self.ball_count,
            "pocketed": True,
            "scratch": False,
            "ring": None,
        }
        self.phase = "cleared"

    def _resume_running(self) -> None:
        self.remaining = {e["ballId"] for e in self.layout if e["ballId"] != "cue"}
        self.current_run = 0
        self.phase = "running"

    def _record_run(self, points: int, scratch: bool) -> None:
        if self.current_player_id is not None:
            self.record_attempt(
                self.current_player_id, points, points > 0, scratch, None
            )

    # ------------------------------------------------------------- snapshot

    def message(self) -> str:
        name = self.player_name(self.current_player_id)
        if self.phase == "capturing":
            return f"{name}: place balls, then capture the layout"
        if self.phase == "running":
            if self.current_run == 0:
                return f"{name}: GO! Clear the table"
            return f"{name}: run {self.current_run} of {self.ball_count}"
        if self.phase == "restoring":
            return f"{name}: place all balls back on the spots"
        if self.phase == "cleared":
            return f"{name}: table cleared! Run of {self.ball_count}"
        if self.phase == "ended":
            return "Session complete"
        return ""

    def _extra(self) -> dict[str, Any]:
        return {
            "ballCount": self.ball_count,
            "currentRun": self.current_run,
            "bestRun": self.best_run,
            "attempts": self.attempt_count,
            "cleared": self.cleared,
        }

    def scene(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if self.phase == "capturing":
            items.append(self.scene_text("PLACE BALLS, THEN CAPTURE", size=48))
        elif self.phase == "running":
            if self.current_run == 0:
                items.append(self.scene_text("GO!", color="accent", dy=-320, size=90))
            else:
                items.append(
                    self.scene_text(
                        f"RUN {self.current_run}", color="accent", dy=-320
                    )
                )
        elif self.phase == "restoring":
            items += self.scene_ghosts(self.layout)
            items.append(
                self.scene_text("PLACE BALLS BACK ON THE SPOTS", dy=-320, size=48)
            )
        elif self.phase == "cleared":
            items.append(
                self.scene_text("TABLE CLEARED!", color="success", dy=-320, size=90)
            )
            items.append(
                self.scene_text(f"RUN OF {self.ball_count}", color="success", dy=-220)
            )
        elif self.phase == "ended":
            items.append(self.scene_text("SESSION COMPLETE"))
        return items
