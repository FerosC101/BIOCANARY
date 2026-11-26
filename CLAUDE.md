# BIOCANARY

Wastewater early-warning platform: compares a reference microbial culture with one exposed to wastewater and flags divergence. The README has full detail; this file is the short version.

## Run
- `scripts/setup.sh` once (installs, migrates, seeds 30 days of simulated data), then `scripts/dev.sh`: API on 8710, web on 5710, simulated devices.
- Ports 8710/5710 because 8000 and 5173 are used by other local services. Never send requests to 8000.
- Demo login: `operator@biocanary.demo` / `listen-today`.
- Tests: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc -b && npx vite build`.
- Reset: stop the stack, delete `backend/var/biocanary.db*`, rerun setup.

## Layout
- `backend/app`: FastAPI, SQLAlchemy, Alembic. `ingest/` device API, `analysis/` pipeline, `cloud/` Huawei adapters (RDS, DCS, OBS, ModelArts), `simulation/`, `reports/`, `cli.py` operations.
- `frontend/src`: React 19 + Vite + TanStack Query, plain CSS in `index.css`. Pages: Dashboard, Facility (3D plant with live stations), Monitoring, AI Analysis, Reports.
- UI style is "bioluminescent": dark night surface, glowing lines, glass panels, top text tabs. Severity is shown with the dial (`components/Dial.tsx`) or `RangeGlyph` + a word; ranges helpers in `lib/ranges.ts`. No pills or warning flags. `/wall` (control-room TV view, in the account menu) and `/plant` (3D plant explainer, link above the Dashboard station cards) are full-screen views outside the five sections. See `docs/design-system.md`.
- `frontend/src/components/device`: three.js viewer (`scene.ts`) and panels; loads `public/device/device.glb` and `device.webp`.
- `ml/`: MindSpore training, exported JSON weights in `ml/artifacts`.
- `device3d/`: Blender model. `build_device.py` rebuilds the `.blend`; `export_web.py` + `optimize_web.mjs` make the web GLB. Commands in `device3d/README.md`. Blender is at `/Applications/Blender.app/Contents/MacOS/Blender`; the first GPU render compiles kernels for about 10 minutes.
- `docs/`: architecture, hardware API, AI method, Huawei deployment, design system.

- Offline demo: without a reachable API the frontend serves `public/demo/snapshot.json` (`src/lib/demo.ts`, banner on every screen, read-only). Re-record with `npm run capture:demo`; build static with `npm run build:demo`.

## Rules (product decisions, do not break)
- Exactly five nav sections: Dashboard, Facility, Monitoring, AI Analysis, Reports.
- Label simulated data everywhere. Never show a Huawei service as connected without a live probe. Never silently fall back from ModelArts.
- Hardware data gets no severity or confidence without a validated protocol or experimental model ("Unclassified").
- Correlation is not cause. Never call water safe or unsafe. Blue/green lighting is decoration, not microbial health.
- Use the official logo (`docs/brand/biocanary-logo.svg`) unmodified. Palette: #254F91 #0B2D6B #2F6BFF #4FD96B #A6F684 #83E6A3 #F0FFD7 #FFFFFF.
- 3D status lamps reflect real state (link, cloud, station status); the model dims when a station is not reporting.

## Git
- Remote: `github.com/FerosC101/BIOCANARY` (public), branch `main`.
- Commit as the repo-local identity (FerosC101 noreply). Never add Claude as co-author or contributor.
- Never commit `.env`, `backend/var/`, or anything with real credentials.

## Known gaps
- Not yet verified: real Huawei Cloud, Docker image builds, a real Redis server, real hardware, Safari/Firefox/real phones for the 3D view.
- `ruff check` reports 31 style findings (mostly unused `noqa`); tests pass.
