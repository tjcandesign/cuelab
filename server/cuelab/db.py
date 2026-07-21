"""SQLite persistence (stdlib sqlite3, WAL journal)."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    initials TEXT,
    color TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_active TEXT
);
CREATE TABLE IF NOT EXISTS drills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT,
    published INTEGER DEFAULT 0,
    json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    drill_id INTEGER,
    rounds INTEGER,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    summary_json TEXT
);
CREATE TABLE IF NOT EXISTS session_players (
    session_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    shots INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    round INTEGER,
    points INTEGER DEFAULT 0,
    pocketed INTEGER DEFAULT 0,
    scratch INTEGER DEFAULT 0,
    ring INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL,
    type TEXT,
    json TEXT
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        with self._lock:
            self.conn.executescript(SCHEMA)
            self.conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> int:
        """Run a write statement, return lastrowid."""
        with self._lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return int(cur.lastrowid or 0)

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def log_event(self, event_type: str, data: dict[str, Any]) -> None:
        try:
            self.execute(
                "INSERT INTO events (ts, type, json) VALUES (?, ?, ?)",
                (time.time(), event_type, json.dumps(data)),
            )
        except Exception:
            pass  # event log must never break the pipeline

    def close(self) -> None:
        with self._lock:
            self.conn.close()
