"""Player and overview statistics from the attempts/sessions tables."""

from __future__ import annotations

from typing import Any

from ..db import Database


def player_stats(db: Database, player_id: int) -> dict[str, Any]:
    rows = db.query(
        "SELECT points, pocketed, scratch FROM attempts WHERE player_id=? ORDER BY id",
        (player_id,),
    )
    attempts = len(rows)
    scored = sum(1 for r in rows if r["points"] > 0)
    pocketed = sum(1 for r in rows if r["pocketed"])
    scratches = sum(r["scratch"] for r in rows)
    best_streak = 0
    streak = 0
    for r in rows:
        if r["pocketed"]:
            streak += 1
            best_streak = max(best_streak, streak)
        else:
            streak = 0
    recent = db.query(
        "SELECT s.id, s.mode, s.started_at, s.ended_at, sp.score, sp.shots"
        " FROM sessions s JOIN session_players sp ON sp.session_id = s.id"
        " WHERE sp.player_id=? ORDER BY s.id DESC LIMIT 5",
        (player_id,),
    )
    return {
        "attempts": attempts,
        "successRate": round(scored / attempts, 4) if attempts else 0.0,
        "shotAccuracy": round(pocketed / attempts, 4) if attempts else 0.0,
        "bestStreak": best_streak,
        "shotsFired": attempts,
        "ballsPocketed": pocketed,
        "ballsMissed": attempts - pocketed,
        "scratches": scratches,
        "recentSessions": [
            {
                "sessionId": r["id"],
                "mode": r["mode"],
                "startedAt": r["started_at"],
                "endedAt": r["ended_at"],
                "score": r["score"],
                "shots": r["shots"],
            }
            for r in recent
        ],
    }


def overview(db: Database) -> dict[str, Any]:
    players = db.query_one("SELECT COUNT(*) AS n FROM players")
    sessions = db.query_one("SELECT COUNT(*) AS n FROM sessions")
    agg = db.query_one(
        "SELECT COUNT(*) AS attempts,"
        " COALESCE(SUM(pocketed), 0) AS pocketed,"
        " COALESCE(SUM(scratch), 0) AS scratches,"
        " COALESCE(SUM(CASE WHEN points > 0 THEN 1 ELSE 0 END), 0) AS scored"
        " FROM attempts"
    )
    attempts = agg["attempts"] if agg else 0
    top = db.query(
        "SELECT p.id, p.name, COALESCE(SUM(a.points), 0) AS total_points,"
        " COUNT(a.id) AS attempts"
        " FROM players p LEFT JOIN attempts a ON a.player_id = p.id"
        " GROUP BY p.id ORDER BY total_points DESC LIMIT 5"
    )
    return {
        "players": players["n"] if players else 0,
        "sessions": sessions["n"] if sessions else 0,
        "attempts": attempts,
        "shotsFired": attempts,
        "ballsPocketed": agg["pocketed"] if agg else 0,
        "scratches": agg["scratches"] if agg else 0,
        "successRate": round((agg["scored"] / attempts), 4) if attempts else 0.0,
        "topPlayers": [
            {
                "playerId": r["id"],
                "name": r["name"],
                "points": r["total_points"],
                "attempts": r["attempts"],
            }
            for r in top
        ],
    }
