# CueLab

CueLab turns a real pool table into an interactive surface. A projector mounted over the table draws drills, targets, ghost-ball layouts, and scoreboards directly on the cloth, and an overhead camera tracks the balls so the system can score shots automatically and keep player stats over time. Everything runs offline on one machine. It is inspired by FusionCue, built local-first for the studio.

## How it works

A Python server (FastAPI) owns the engine: a 2D physics simulation and a computer-vision pipeline that both produce the same ball-state stream, plus game logic (target pool, 9-ball, drills), and SQLite persistence for players, drills, sessions, and every attempt. A web app (Vite + React) renders three surfaces off that one server: the projector output, the control/TV screen, and management pages for the drill editor, player stats, the calibration wizard, and a hardware planner. The two talk over REST and a WebSocket that streams ball positions at ~30 Hz while anything moves.

All geometry lives in table space: millimeters, origin at the top-left corner of the playing surface. Camera and projector each get calibrated to that space with a homography, so drills and games never care which mode they run in.

## Quickstart

The Python venv already exists at `server/.venv`. Two terminals:

```
cd server && .venv/bin/python -m uvicorn cuelab.main:app --port 8000
cd web && npm run dev
```

Open http://localhost:5173. Sim mode is the default, so the whole system works with no projector, no camera, and no table. The simulated table even renders perspective-distorted camera frames, which means you can run the full calibration wizard against synthetic hardware before buying anything.

## The two modes

- **sim** (default): a built-in physics table stands in for reality. Place balls, shoot them from the control screen, watch games score themselves. Good for development, drill authoring, and demoing.
- **camera**: a real overhead camera feeds a classical CV detector that finds and identifies balls on the cloth. Same events, same games, same everything. Switch modes in config (`PUT /api/config` or the setup page).

## What's built vs. what's planned

| Built today | Roadmap |
|---|---|
| Sim physics table with synthetic camera | Custom-trained ball detector (see [docs/TRAINING.md](docs/TRAINING.md)) |
| Target pool (the FusionCue flagship game) | Drill publishing / community sharing |
| 9-ball basics | Real-time online multiplayer |
| Drill practice + drill editor | Auto-updates |
| Player profiles and stats | |
| Camera calibration flow (works on synthetic camera) | |
| Projector keystone calibration | |
| Hardware planner | |
| In-browser voice commands | |
| Optional LLM voice coach (needs `ANTHROPIC_API_KEY`) | |
| Session recording to mp4 | |

## Docs

- [docs/SETUP.md](docs/SETUP.md): hardware buying and rigging guide (projector, camera, lights, mounting)
- [docs/CALIBRATION.md](docs/CALIBRATION.md): the 3-step calibration wizard
- [docs/TRAINING.md](docs/TRAINING.md): path from the classical detector to a trained model
