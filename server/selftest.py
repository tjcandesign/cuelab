"""CueLab headless self-test.

Exercises: homography solve roundtrip, sim physics (travel, cushion,
pocket, scratch, collision), a complete 2-player target_pool round driven
programmatically, drill/nine_ball/free sessions, stats queries, WS,
recording, calibration + synthetic camera, voice 501.

Run: .venv/bin/python selftest.py  (from server/)
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVER_DIR))

TMP = tempfile.mkdtemp(prefix="cuelab-selftest-")
os.environ["CUELAB_DATA_DIR"] = TMP
os.environ["CUELAB_TIME_SCALE"] = "10"  # sim runs 10x wall clock
os.environ["CUELAB_TIMER_SCALE"] = "0.05"  # game timers 20x faster
os.environ.pop("ANTHROPIC_API_KEY", None)

import numpy as np  # noqa: E402

PASSED: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {name}")
        PASSED.append(name)
    else:
        print(f"  FAIL  {name}  {detail}")
        sys.exit(1)


# --------------------------------------------------------------------------
print("[1] homography solve roundtrip")
from cuelab.calibration import CalibrationStore, apply_homography  # noqa: E402
from cuelab.render import (  # noqa: E402
    synthetic_table_corners,
    table_mm_to_synthetic_px,
)

L, W = 2235.2, 1117.6
store = CalibrationStore(Path(TMP) / "calib-unit.json")
corners = synthetic_table_corners(L, W)
H = np.array(store.solve_camera(corners, L, W))
worst = 0.0
for x, y in [(600.0, 300.0), (1500.0, 800.0), (200.0, 900.0), (1117.6, 558.8)]:
    u, v = table_mm_to_synthetic_px(x, y, L, W)
    mx, my = apply_homography(H, u, v)
    worst = max(worst, math.hypot(mx - x, my - y))
check("synthetic corners -> H -> point error < 2mm", worst < 2.0, f"worst={worst:.4f}mm")

# --------------------------------------------------------------------------
print("[2] sim physics (direct stepping)")
from cuelab.engine.sim import SUBSTEP, SimEngine  # noqa: E402

eng = SimEngine(L, W)


def run_settled(engine: SimEngine, max_s: float = 40.0) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for _ in range(int(max_s / SUBSTEP)):
        engine._step(SUBSTEP)
        if all(b.speed == 0.0 for b in engine._balls.values()):
            break
    events.extend(engine.drain_events())
    return events


# travel: v^2 / (2a) = 800^2 / 600 = 1066.7mm
eng.reset([{"id": "cue", "x": 300, "y": 559}])
eng.drain_events()
eng.shoot("cue", 0.0, 800.0)
events = run_settled(eng)
cue = eng._balls["cue"]
travel = cue.x - 300
types = [e[0] for e in events]
check("straight shot travels ~1067mm and settles",
      abs(travel - 1066.7) < 40 and cue.speed == 0.0, f"travel={travel:.1f}")
check("shot_start + shot_end emitted", "shot_start" in types and "shot_end" in types,
      str(types))

# cushion bounce stays in bounds
eng.reset([{"id": "cue", "x": 1800, "y": 559}])
eng.drain_events()
eng.shoot("cue", 0.0, 1500.0)
in_bounds = True
bounced = False
for _ in range(int(40 / SUBSTEP)):
    eng._step(SUBSTEP)
    b = eng._balls.get("cue")
    if b is None:
        in_bounds = False
        break
    if not (28.4 <= b.x <= L - 28.4 and 28.4 <= b.y <= W - 28.4):
        in_bounds = False
        break
    if b.vx < 0:
        bounced = True
    if b.speed == 0.0:
        break
eng.drain_events()
check("cushion bounce stays in bounds and reverses",
      in_bounds and bounced and eng._balls["cue"].x < 1800,
      f"x={eng._balls['cue'].x if 'cue' in eng._balls else 'gone'}")

# aimed shot pockets a ball
eng.reset([{"id": "b1", "x": 300, "y": 300}])
eng.drain_events()
angle = math.degrees(math.atan2(0 - 300, 0 - 300))
eng.shoot("b1", angle, 1200.0)
events = run_settled(eng)
pocketed = [d for t, d in events if t == "ball_pocketed"]
shot_end = next((d for t, d in events if t == "shot_end"), None)
check("aimed shot pockets b1 in tl",
      len(pocketed) == 1 and pocketed[0]["ballId"] == "b1"
      and pocketed[0]["pocket"] == "tl" and "b1" not in eng._balls,
      str(events))
check("shot_end carries ballsPocketed",
      shot_end is not None and any(
          bp["ballId"] == "b1" for bp in shot_end["ballsPocketed"]),
      str(shot_end))

# scratch
eng.reset([{"id": "cue", "x": 300, "y": 300}])
eng.drain_events()
eng.shoot("cue", angle, 1200.0)
events = run_settled(eng)
shot_end = next((d for t, d in events if t == "shot_end"), None)
check("cue in pocket -> scratch event + cueScratched",
      any(t == "scratch" for t, _ in events)
      and shot_end is not None and shot_end["cueScratched"] is True,
      str(events))

# ball-ball collision transfers momentum
eng.reset([{"id": "cue", "x": 500, "y": 559}, {"id": "b1", "x": 700, "y": 559}])
eng.drain_events()
eng.shoot("cue", 0.0, 1000.0)
run_settled(eng)
check("collision moves object ball downstream",
      "b1" in eng._balls and eng._balls["b1"].x > 750,
      f"b1.x={eng._balls['b1'].x if 'b1' in eng._balls else 'gone'}")

# --------------------------------------------------------------------------
print("[3] full server (TestClient)")
from fastapi.testclient import TestClient  # noqa: E402

from cuelab.main import app  # noqa: E402

DB_PATH = Path(TMP) / "cuelab.db"


def db_query(sql: str, params: tuple = ()) -> list[tuple]:
    conn = sqlite3.connect(str(DB_PATH))
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


with TestClient(app) as client:
    r = client.get("/api/health")
    check("GET /api/health", r.status_code == 200 and r.json()["ok"] is True
          and r.json()["mode"] == "sim", r.text)

    r = client.get("/api/config")
    check("GET /api/config", r.status_code == 200 and r.json()["tableSize"] == "8ft",
          r.text)

    r = client.get("/api/camera/snapshot.jpg")
    check("synthetic camera snapshot is a JPEG",
          r.status_code == 200 and r.content[:2] == b"\xff\xd8" and len(r.content) > 5000,
          f"{r.status_code} {len(r.content)}B")

    # calibration flow against the synthetic camera
    corners = synthetic_table_corners(L, W)
    r = client.post("/api/calibration/camera", json={"points": corners})
    check("POST /api/calibration/camera solves H",
          r.status_code == 200 and len(r.json()["H"]) == 3, r.text)
    Hs = np.array(r.json()["H"])
    u, v = table_mm_to_synthetic_px(1000.0, 700.0, L, W)
    mx, my = apply_homography(Hs, u, v)
    err = math.hypot(mx - 1000.0, my - 700.0)
    check("stored H roundtrip < 2mm", err < 2.0, f"err={err:.4f}")
    r = client.get("/api/calibration")
    check("GET /api/calibration has points + H",
          r.json()["camera"]["H"] is not None
          and r.json()["camera"]["points"] is not None, r.text)
    r = client.get("/api/calibration/camera/preview.jpg")
    check("calibration preview is a JPEG",
          r.status_code == 200 and r.content[:2] == b"\xff\xd8", str(r.status_code))
    r = client.post("/api/calibration/projector",
                    json={"corners": [[0, 0], [1920, 0], [1920, 1080], [0, 1080]]})
    check("POST /api/calibration/projector", r.status_code == 200, r.text)
    r = client.post("/api/calibration/verify")
    check("verify (sim) simulated pass",
          r.status_code == 200 and r.json()["ok"] is True
          and r.json()["errorsMm"] is not None, r.text)

    # websocket hello + initial messages
    time.sleep(0.6)
    with client.websocket_connect("/ws") as ws:
        got = [ws.receive_json() for _ in range(3)]
        ws.send_json({"type": "hello", "role": "control"})
        types = {m["type"] for m in got}
        check("WS sends state/game/scene on connect",
              types == {"state", "game", "scene"}, str(types))
        state = next(m for m in got if m["type"] == "state")
        check("WS state has contract ball fields",
              {"id", "number", "kind", "x", "y", "vx", "vy", "settled", "color"}
              <= set(state["balls"][0].keys()), str(state["balls"][:1]))

    # players
    p1 = client.post("/api/players", json={"name": "Don"}).json()
    p2 = client.post("/api/players", json={"name": "Maria"}).json()
    check("create players", p1["id"] != p2["id"] and p1["initials"] == "DO",
          f"{p1} {p2}")

    # ---------------------------------------------------------- target pool
    print("[4] target_pool: full 2-player round")
    r = client.post("/api/sessions", json={
        "mode": "target_pool", "playerIds": [p1["id"], p2["id"]], "rounds": 1,
    })
    check("POST /api/sessions", r.status_code == 201, r.text)
    snap = r.json()
    sid = snap["sessionId"]
    check("phase=setting, setter assigned",
          snap["phase"] == "setting" and snap["setterId"] in (p1["id"], p2["id"]),
          str(snap))

    LAYOUT = [{"id": "cue", "x": 600, "y": 600}, {"id": "b1", "x": 1200, "y": 600}]
    client.post("/api/sim/reset", json={"balls": LAYOUT})

    def get_snap() -> dict:
        return client.get(f"/api/sessions/{sid}").json()

    def wait_phase(*phases: str, timeout: float = 20.0) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = get_snap()
            if s["phase"] in phases:
                return s
            time.sleep(0.05)
        raise AssertionError(f"timeout waiting for {phases}, at {get_snap()['phase']}")

    def wait_attempts(n: int, timeout: float = 20.0) -> None:
        t0 = time.time()
        while time.time() - t0 < timeout:
            rows = db_query("SELECT COUNT(*) FROM attempts WHERE session_id=?", (sid,))
            if rows[0][0] >= n:
                return
            time.sleep(0.05)
        raise AssertionError(f"timeout waiting for {n} attempts")

    s = client.post(f"/api/sessions/{sid}/action", json={"action": "lock_layout"}).json()
    check("lock_layout -> call_pocket",
          s["phase"] == "call_pocket" and len(s["layout"]) == 2, str(s))
    s = client.post(f"/api/sessions/{sid}/action",
                    json={"action": "call_pocket", "pocket": "tr"}).json()
    tgt = s["target"]
    check("call_pocket -> target_shown with rails-clear target",
          s["phase"] == "target_shown" and s["calledPocket"] == "tr"
          and tgt["radii"] == [90.0, 180.0, 270.0] and tgt["scores"] == [6, 4, 2]
          and 250 <= tgt["c"][0] <= L - 250 and 250 <= tgt["c"][1] <= W - 250,
          str(s))

    for shooter_i in range(2):
        s = wait_phase("placing", "countdown", "live")
        # place balls back on the ghost spots (auto layout_matched within 25mm)
        for spec in LAYOUT:
            client.post("/api/sim/place", json=spec)
        s = wait_phase("live")
        shooter_id = s["currentPlayerId"]
        client.post("/api/sim/shoot",
                    json={"ballId": "cue", "angle": 0, "speed": 900})
        wait_attempts(shooter_i + 1)
        rows = db_query(
            "SELECT player_id, points, pocketed, scratch FROM attempts"
            " WHERE session_id=? ORDER BY id", (sid,))
        check(f"attempt {shooter_i + 1} persisted for shooter",
              rows[shooter_i][0] == shooter_id and rows[shooter_i][1] is not None,
              str(rows))

    s = wait_phase("ended")
    check("round complete -> session ended", s["phase"] == "ended", str(s))
    rows = db_query("SELECT COUNT(*) FROM attempts WHERE session_id=?", (sid,))
    check("2 attempts persisted", rows[0][0] == 2, str(rows))

    # rescore fixes a score
    s = client.post(f"/api/sessions/{sid}/action",
                    json={"action": "rescore", "playerId": p1["id"], "points": 6}).json()
    row = db_query(
        "SELECT points FROM attempts WHERE session_id=? AND player_id=?"
        " ORDER BY id DESC LIMIT 1", (sid, p1["id"]))
    check("rescore updates the attempt row", row[0][0] == 6, str(row))
    player1 = next(p for p in s["players"] if p["id"] == p1["id"])
    check("rescore updates in-session score", player1["score"] == 6, str(s["players"]))
    client.post(f"/api/sessions/{sid}/action", json={"action": "end"})

    ended = client.get(f"/api/sessions/{sid}").json()
    check("GET ended session", ended["sessionId"] == sid, str(ended))

    # ---------------------------------------------------------------- stats
    print("[5] stats")
    st = client.get(f"/api/players/{p1['id']}/stats").json()
    check("player stats shape",
          st["attempts"] >= 1 and "successRate" in st and "shotAccuracy" in st
          and "bestStreak" in st and "recentSessions" in st
          and st["shotsFired"] >= 1, str(st))
    ov = client.get("/api/stats/overview").json()
    check("stats overview aggregates", ov["attempts"] >= 2 and ov["players"] >= 2,
          str(ov))

    # ---------------------------------------------------------------- drills
    print("[6] drills + drill session")
    drill_body = {
        "name": "Long pot", "type": "potting", "description": "pot the 9 long",
        "table": "8ft",
        "balls": [{"id": "cue", "kind": "cue", "number": 0, "x": 560, "y": 560},
                  {"id": "b9", "kind": "stripe", "number": 9, "x": 1600, "y": 560}],
        "targets": [], "successCriteria": {"mustPocket": ["b9"], "maxShots": 1},
        "tags": ["potting"], "published": True,
    }
    d = client.post("/api/drills", json=drill_body).json()
    check("create drill", d["id"] >= 1 and d["name"] == "Long pot", str(d))
    lst = client.get("/api/drills").json()
    check("list drills", any(x["id"] == d["id"] for x in lst), str(lst))
    exp = client.get(f"/api/drills/{d['id']}/export").json()
    check("export drill", exp["successCriteria"] == drill_body["successCriteria"],
          str(exp))
    imp = client.post("/api/drills/import", json=exp).json()
    check("import drill", imp[0]["id"] != d["id"], str(imp))
    client.delete(f"/api/drills/{imp[0]['id']}")

    r = client.post("/api/sessions", json={
        "mode": "drill", "playerIds": [p1["id"]], "rounds": 1, "drillId": d["id"],
    })
    dsnap = r.json()
    dsid = dsnap["sessionId"]
    check("drill session starts placing",
          r.status_code == 201 and dsnap["phase"] == "placing", r.text)
    client.post("/api/sim/reset", json={"balls": [
        {"id": "cue", "x": 560, "y": 560}, {"id": "b9", "x": 1600, "y": 560}]})

    def wait_drill_phase(*phases: str, timeout: float = 20.0) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = client.get(f"/api/sessions/{dsid}").json()
            if s["phase"] in phases:
                return s
            time.sleep(0.05)
        raise AssertionError(f"timeout: {phases}")

    wait_drill_phase("live")
    client.post("/api/sim/shoot", json={"ballId": "cue", "angle": 0, "speed": 700})
    t0 = time.time()
    while time.time() - t0 < 20:
        if db_query("SELECT COUNT(*) FROM attempts WHERE session_id=?", (dsid,))[0][0]:
            break
        time.sleep(0.05)
    rows = db_query("SELECT points FROM attempts WHERE session_id=?", (dsid,))
    check("drill attempt auto-scored", len(rows) == 1, str(rows))
    client.post(f"/api/sessions/{dsid}/action", json={"action": "mark", "success": True})
    rows = db_query("SELECT points FROM attempts WHERE session_id=?", (dsid,))
    check("manual mark overrides", rows[0][0] == 1, str(rows))
    client.post(f"/api/sessions/{dsid}/action", json={"action": "end"})

    # ------------------------------------------------------------ nine ball
    print("[7] nine_ball session")
    r = client.post("/api/sessions", json={
        "mode": "nine_ball", "playerIds": [p1["id"], p2["id"]], "rounds": 1})
    nsnap = r.json()
    nsid = nsnap["sessionId"]
    check("nine_ball starts live with rack in extra",
          nsnap["phase"] == "live" and nsnap["extra"]["remaining"] == list(range(1, 10))
          and nsnap["extra"]["onBall"] == 1, str(nsnap))
    client.post("/api/sim/reset", json={})  # default rack
    client.post("/api/sim/shoot", json={"ballId": "cue", "angle": 0, "speed": 2500})
    t0 = time.time()
    while time.time() - t0 < 25:
        if db_query("SELECT COUNT(*) FROM attempts WHERE session_id=?", (nsid,))[0][0]:
            break
        time.sleep(0.05)
    rows = db_query("SELECT COUNT(*) FROM attempts WHERE session_id=?", (nsid,))
    check("nine_ball break recorded as attempt", rows[0][0] >= 1, str(rows))
    s = client.get(f"/api/sessions/{nsid}").json()
    check("nine_ball rack state tracked",
          set(s["extra"]["remaining"]) <= set(range(1, 10)), str(s["extra"]))
    client.post(f"/api/sessions/{nsid}/action", json={"action": "foul"})
    client.post(f"/api/sessions/{nsid}/action", json={"action": "rerack"})
    s = client.get(f"/api/sessions/{nsid}").json()
    check("rerack restores rack", s["extra"]["remaining"] == list(range(1, 10)),
          str(s["extra"]))
    client.post(f"/api/sessions/{nsid}/action", json={"action": "end"})

    # ----------------------------------------------------------------- free
    print("[8] free session")
    r = client.post("/api/sessions", json={
        "mode": "free", "playerIds": [p2["id"]], "rounds": 1})
    fsid = r.json()["sessionId"]
    client.post("/api/sim/reset", json={"balls": [{"id": "cue", "x": 600, "y": 559}]})
    client.post("/api/sim/shoot", json={"ballId": "cue", "angle": 0, "speed": 600})
    t0 = time.time()
    while time.time() - t0 < 20:
        s = client.get(f"/api/sessions/{fsid}").json()
        if s["extra"]["shots"] >= 1:
            break
        time.sleep(0.05)
    check("free mode accumulates stats", s["extra"]["shots"] >= 1, str(s["extra"]))
    client.post(f"/api/sessions/{fsid}/action", json={"action": "end"})

    # ------------------------------------------------------------ recording
    print("[9] recording")
    r = client.post("/api/recording/start")
    check("recording start", r.status_code == 200, r.text)
    time.sleep(1.0)
    r = client.post("/api/recording/stop")
    fname = r.json().get("file")
    check("recording stop returns file", r.status_code == 200 and fname, r.text)
    path = Path(TMP) / "recordings" / fname
    check("mp4 written with frames", path.exists() and path.stat().st_size > 2000,
          f"{path} {path.stat().st_size if path.exists() else 'missing'}")
    lst = client.get("/api/recordings").json()
    check("GET /api/recordings", any(x["file"] == fname for x in lst), str(lst))

    # ---------------------------------------------------------------- voice
    print("[10] voice coach (no key -> 501)")
    r = client.post("/api/voice/chat", json={"text": "how do I draw the ball?"})
    check("voice 501 without ANTHROPIC_API_KEY",
          r.status_code == 501 and r.json()["reply"] is None
          and "ANTHROPIC_API_KEY" in r.json()["error"], r.text)

    # ------------------------------------------------- config + camera mode
    print("[11] config merge + camera-mode boot without hardware")
    r = client.put("/api/config", json={"tableSize": "9ft"})
    check("PUT /api/config resolves preset",
          r.json()["tableL"] == 2540.0 and r.json()["tableW"] == 1270.0, r.text)
    r = client.put("/api/config", json={
        "mode": "camera", "camera": {"source": "/nonexistent/cuelab-test.mp4"}})
    check("switch to camera mode", r.json()["mode"] == "camera", r.text)
    time.sleep(0.5)
    r = client.get("/api/health")
    check("server healthy with no camera attached",
          r.status_code == 200 and r.json()["mode"] == "camera", r.text)
    r = client.get("/api/camera/snapshot.jpg")
    check("snapshot serves placeholder without camera",
          r.status_code == 200 and r.content[:2] == b"\xff\xd8", str(r.status_code))
    r = client.put("/api/config", json={"mode": "sim", "tableSize": "8ft",
                                        "camera": {"source": 0}})
    check("switch back to sim", r.json()["mode"] == "sim", r.text)

print()
print(f"ALL {len(PASSED)} CHECKS PASSED")
