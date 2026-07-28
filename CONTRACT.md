# CueLab — build contract

CueLab is a local-first pool table projection, ball-tracking, and game-scoring system (FusionCue-class). One Python server owns vision/simulation, game logic, and persistence; one web app renders three surfaces: the projector output, the control/TV screen, and management pages (drills, players, setup, hardware planner).

Everything runs offline on one machine. Two engine modes, switchable in config:

- `sim` (default) — a built-in 2D physics simulation stands in for the real table. The synthetic camera renders perspective-distorted frames so even camera calibration is testable without hardware.
- `camera` — real overhead camera, classical CV ball detection (pluggable detector interface for a trained model later).

## Layout & ownership

- `server/` — Python FastAPI app. **Server agent owns this dir exclusively.**
- `web/` — Vite + React + TypeScript app. **Web agent owns this dir exclusively.**
- `README.md`, `docs/` — **Docs agent owns these exclusively.**

Do not create or edit files outside your dir. Deps are pre-installed: `server/.venv` (Python 3.14: fastapi, uvicorn, opencv-python, numpy, pydantic v2, anthropic) and `web/node_modules` (react 19, react-router-dom 7, zustand 5, vite 6, typescript 5).

## Runtime

- Server: `server/.venv/bin/python -m uvicorn cuelab.main:app --port 8000` run from `server/`. Also support `server/.venv/bin/python -m cuelab` doing the same.
- Web dev: `npm run dev` in `web/` → port 5173. Vite proxies `/api` and `/ws` (ws: true) to `http://localhost:8000`.
- Persistent state in `server/data/` (gitignored): `config.json`, `cuelab.db`, `recordings/`.

## Coordinate system

- **Table space**: millimeters. Origin = top-left corner of the *playing surface* viewed top-down. +x runs along the long rail (length L), +y along the short rail (width W). All ball positions, scene primitives, drills, and homographies use table space.
- Table presets: `7ft` 1981.2×990.6, `8ft` 2235.2×1117.6 (**default**), `9ft` 2540×1270. Config carries `tableSize` preset plus resolved `tableL`/`tableW` (custom allowed).
- Ball diameter 57.15 mm (radius 28.575).
- Pockets (ids and centers): `tl`(0,0), `ts`(L/2,0), `tr`(L,0), `bl`(0,W), `bs`(L/2,W), `br`(L,W). Capture radius 85 mm corners, 75 mm sides.

## WebSocket `/ws`

Server → client JSON messages. On connect, server immediately sends the latest of each.

1. `{"type":"state","ts":<ms>,"moving":<bool>,"balls":[{"id":"cue","number":0,"kind":"cue|solid|stripe|eight|unknown","x":<mm>,"y":<mm>,"vx":<mm/s>,"vy":<mm/s>,"settled":<bool>,"color":"#hex"}]}` — ~30 Hz while anything moves, ~4 Hz idle. Ball ids: `"cue"`, `"b1"`…`"b15"`.
2. `{"type":"event","event":"shot_start|shot_end|ball_pocketed|scratch|balls_settled|ball_added|ball_removed|layout_matched","data":{...}}` — `ball_pocketed` data: `{"ballId","pocket"}`.
3. `{"type":"game","game":<snapshot|null>}` — sent on every game-state change.
4. `{"type":"scene","items":[<primitive>...]}` — projector scene graph, sent whenever it changes.

Client → server: `{"type":"hello","role":"control|projector|viewer"}`. All control mutations go through REST.

### Game snapshot

```json
{"sessionId":1,"mode":"target_pool|nine_ball|drill|free","phase":"...","round":1,"totalRounds":10,
 "players":[{"id":1,"name":"Don","initials":"D","color":"#8b5cf6","score":0,"shots":0}],
 "currentPlayerId":1,"setterId":1,"message":"Don: place cue + object ball","countdown":null,
 "calledPocket":null,"target":{"c":[x,y],"radii":[90,180,270],"scores":[6,4,2]},
 "layout":[{"ballId":"cue","x":0,"y":0}],"lastResult":{"playerId":1,"points":4,"pocketed":true,"ring":1,"scratch":false},
 "extra":{}}
```

`extra` carries mode-specific data (e.g. nine_ball rack state). Web renders defensively — missing/null fields are fine.

### Target pool phases (flagship mode, from the FusionCue demo)

`setting` (setter places cue + one object ball) → `call_pocket` (setter calls a pocket) → `target_shown` (server drops a random 3-ring bullseye ≥250 mm from rails/balls, locks the layout as ghost positions) → per shooter, random order: `placing` (project ghosts; balls within 25 mm of ghosts → `layout_matched` → auto-advance) → `countdown` (5→1, projected) → `live` (shot happens) → `result` (score shown ~4 s) → next shooter → after all: `round_done` → next round, setter rotates.

Scoring per shot: called ball must drop in the called pocket and no scratch, else 0. If pocketed: 6/4/2 points by which ring the cue ball settles in (innermost→outer), 0 outside all rings. Every attempt is persisted.

REST action `next` force-advances any phase. Sim mode auto-detects placement matches like camera mode would.

### Scene primitives (projector graphics, table-space mm)

Colors: token `"accent"|"white"|"dim"|"success"|"danger"` or `#hex`.

- `{"kind":"ring","c":[x,y],"radii":[r...],"labels":["6","4","2"],"color":"accent"}`
- `{"kind":"ghost","c":[x,y],"r":28.575,"color":"white","label":"CUE"}`
- `{"kind":"line","a":[x,y],"b":[x,y],"width":6,"dash":true,"color":"dim"}`
- `{"kind":"text","c":[x,y],"text":"PLACE BALLS BACK ON THE SPOTS","size":60,"rot":0,"color":"white"}`
- `{"kind":"pocket","pocket":"tr","color":"accent"}` — highlight a called pocket
- `{"kind":"countdown","c":[x,y],"value":4}`
- `{"kind":"poly","points":[[x,y]...],"color":"accent","fill":false}`

## REST API (all under `/api`)

- `GET /health` → `{ok:true, mode, version}`
- `GET /config` / `PUT /config` (partial merge) → `{mode:"sim|camera", tableSize:"8ft", tableL, tableW, camera:{source:0, width:1920, height:1080}, projector:{width:1920, height:1080}}`
- `GET /camera/snapshot.jpg` — current frame (sim: synthetic perspective render of the virtual table). `GET /camera/mjpeg` — multipart stream.
- `GET /calibration` → `{camera:{points:[[x,y]×4]|null, H:[[...]×3]|null}, projector:{corners:[[x,y]×4]|null}}`
- `POST /calibration/camera` body `{points:[[x,y]×4]}` camera-pixel corners of the playing surface in order tl,tr,br,bl → solves & stores camera→table homography, returns `{H}`.
- `GET /calibration/camera/preview.jpg` — top-down warp using stored H.
- `POST /calibration/projector` body `{corners:[[x,y]×4]}` projector-pixel positions of table corners tl,tr,br,bl → stored.
- `POST /calibration/verify` → `{ok, errorsMm:[...]|null, note}` (projects markers, detects them via camera, reports offsets; sim returns a simulated pass).
- Players: `GET|POST /players`, `GET|PATCH|DELETE /players/{id}`, `GET /players/{id}/stats` → `{attempts, successRate, shotAccuracy, bestStreak, shotsFired, ballsPocketed, ballsMissed, scratches, recentSessions:[...]}`
- Drills: `GET|POST /drills`, `GET|PUT|DELETE /drills/{id}`, `POST /drills/import` (raw JSON), `GET /drills/{id}/export`
- Sessions: `POST /sessions` body `{mode, playerIds:[...], rounds, drillId?}` → snapshot. `GET /sessions/{id}`. `POST /sessions/{id}/action` body `{action, ...params}` → snapshot. Actions — target_pool: `lock_layout`, `call_pocket {pocket}`, `next`, `rescore {playerId, points}`, `end`; drill: `next`, `mark {success}`, `end`; nine_ball: `foul`, `rerack`, `next`, `end`; all: `end`.
- Sim control: `POST /sim/reset {balls?:[{id,x,y}]}` (default: cue + 9-ball rack-ish spread), `POST /sim/place {id,x,y}`, `POST /sim/shoot {ballId:"cue", angle:<deg, 0=+x, positive rotates toward +y>, speed:<mm/s ≤ 6000>}`, `POST /sim/add {id}`, `POST /sim/remove {id}`
- Recording: `POST /recording/start`, `POST /recording/stop` → `{file}`, `GET /recordings` (works in sim: writes synthetic frames to mp4).
- Voice coach: `POST /voice/chat {text}` → `{reply}` — uses Anthropic API (model `claude-haiku-4-5-20251001`) with a pool-coach persona + live game-state summary in the system prompt; returns HTTP 501 with a friendly message when `ANTHROPIC_API_KEY` is unset.
- `GET /stats/overview` → totals across players/sessions.

## Drill JSON

```json
{"id":1,"name":"Yo-yo draw","type":"target_pool_layout|position|potting|custom","description":"",
 "table":"8ft","balls":[{"id":"cue","kind":"cue","number":0,"x":560,"y":560}],
 "targets":[{"c":[x,y],"radii":[90,180,270],"scores":[6,4,2]}],"calledPocket":"tr",
 "successCriteria":{"mustPocket":["b9"],"cueInTarget":true,"maxShots":1},
 "tags":["draw"],"published":false}
```

## SQLite (`server/data/cuelab.db`)

`players(id,name,initials,color,created_at,last_active)` · `drills(id,name,type,published,json,created_at,updated_at)` · `sessions(id,mode,drill_id,rounds,started_at,ended_at,summary_json)` · `session_players(session_id,player_id,score,shots)` · `attempts(id,session_id,player_id,round,points,pocketed,scratch,ring,created_at)` · `events(id,ts,type,json)`

## FusionCue-parity extensions (v2)

Local-first equivalents of FusionCue's remaining features. Same ownership rules: server agent implements server side, web agent the UI.

### Shot metrics + analysis

Server segments every shot (existing `shot_start`/`shot_end` events) and computes metrics from the frame history between them:

- `cueSpeedMph` — peak cue-ball speed within 400 ms after `shot_start`, mm/s → mph (÷ 447.04).
- `firstContact` — id of first object ball whose distance to cue ≤ 2r+6 mm, else `null`.
- `objectTravelPct` — summed path length of all non-cue balls ÷ table length L × 100, 1 decimal.
- `railContacts` — count of cue-ball rail reflections (velocity sign flip within 40 mm of a rail).
- `pocketed` — list of `{ballId, pocket}` during the shot; `scratch` bool.
- `made` — bool|null, filled by the active game mode's judgment when available (drill/target_pool/instant_recall), else null.
- `trackedFrames` — frame count; `paths` — per-ball downsampled polylines `[{id, pts:[[x,y],...]}]` (≤120 pts/ball).

New table `shots(id, session_id, player_id, round, ts_start, ts_end, metrics_json, paths_json)`. Persist every shot that occurs while a session is active. WS event `shot_recorded` with `{shotId, sessionId, metrics}` (no paths).

REST: `GET /sessions/{id}/shots` → `[{id, playerId, round, tsStart, tsEnd, metrics}]`; `GET /shots/{id}` → full record incl. `paths`.

Web: Analysis page `/sessions/:id/analysis` — FusionCue-style: shot timeline strip (round/shot chips, green dot made / red missed), selected shot renders both recorded paths on the table view with a metrics panel (MADE/MISSED, target, first contact, object travel %, cue speed mph, rail contact, pocketed).

### Instant Recall (game mode `instant_recall`)

Single player. Phases:

`capturing` (place balls freely; `POST action {action:"capture"}` locks the current settled layout — every ball on table — as the reference; requires ≥2 balls) → `running` (clear the table in any order; each `ball_pocketed` +1 to current run; `balls_settled` with no pocket and no scratch = miss) → on miss/scratch: `restoring` (scene shows ghost drop spots for every non-pocketed reference ball; when all balls are back within 25 mm of reference → `layout_matched` → auto back to `running`, current run resets to the count already pocketed stays — no: current run resets to 0 and ALL reference balls must be restored, i.e. re-place pocketed balls too) → table cleared: `cleared` (session best run = ball count; message + projected celebration) → `capturing` for a new layout or `end`.

Snapshot `extra`: `{"ballCount":N,"currentRun":n,"bestRun":n,"attempts":n,"cleared":bool}`. Actions: `capture`, `mark {success}` (manual override), `reset_layout` (back to `capturing`), `next` (force-advance), `end`.

Persist per-session summary; `attempts` rows: one per run attempt, `points` = run length.

### Games overview

`GET /games/overview` → `{"gamesPlayed":N,"targetPoolHigh":N,"instantRecallBest":N,"lastSession":{"id","mode","score","endedAt"}|null}` (from sessions/attempts).

Web: Games page — stat tiles + a card per game (Instant Recall, Target Pool) with description, personal best, My Stats, Launch Game; below, **Layout maps**: grid of published drills of type `target_pool_layout|position` rendered as mini table maps (dashed numbered circles).

### Community (local)

New table `posts(id, player_id, text, session_id NULL, drill_id NULL, created_at)`.

- `GET|POST /posts` (POST body `{playerId, text, sessionId?, drillId?}`) → post rows joined with player name/initials/color.
- `GET /activity?limit=30` → merged feed, newest first: drill published/updated, session completed (with mode+score), post created, player created. Shape: `[{ts, type:"drill_published|session_completed|post|player_joined", playerName, text, refId}]`.

Web: Dashboard becomes the home route `/` — three columns like FusionCue: community feed (posts + composer, session/drill attachments render as cards with a "View session analysis" link), Latest Drills (cards: name, tags, difficulty chip, players, Add to my drills = duplicate), Activity list + online players.

### Presence + invites (LAN)

WS `hello` gains optional `playerId`. Server keeps in-memory presence `{playerId: connCount}`; `GET /presence` → `[{playerId, name, initials, color, online:true}]` (players with ≥1 conn). Broadcast WS `{"type":"presence","online":[playerIds]}` on change.

In-memory invites: `POST /invites {fromPlayerId, toPlayerId, mode:"drill|target_pool|instant_recall", drillId?, rounds}` → id; WS broadcast `{"type":"invite","invite":{id,from:{...},to:{...},mode,drillName,rounds,status:"pending"}}`. `POST /invites/{id}/accept` → creates the session (both players), broadcasts updated invite + `game` snapshot. `POST /invites/{id}/decline`. Invites expire after 120 s.

Web: online players list shows Invite buttons opening a FusionCue-style modal (game type, drill search, rounds 3/5/7/9/15); incoming invite = toast on every surface with Accept/Decline.

### Voice transcript banner

Web-only: while voice commands are active, show a live STT banner (mic icon + interim/final transcript, fades after 3 s) on Play and TableView, styled like FusionCue's.

## Visual language (web)

Dark, quiet, precise. Tokens: bg `#0b0b10`, panel `#15151c`, border `#26262f`, text `#e8e8ef`, dim `#8b8b98`, accent `#8b5cf6`, success `#34d399`, danger `#f87171`, cloth render `#2273c9`. System/Inter type; uppercase mono micro-labels (11px, letter-spacing 0.12em) for card headers. 1px borders, 10–14px radii, no shadows-as-decoration, **no left-border accent callout boxes**. Projector page: pure black background (black projects as nothing), thick high-contrast strokes (≥4 mm at table scale).
