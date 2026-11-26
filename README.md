# BIOCANARY

Biological wastewater monitoring and early warning. BIOCANARY compares microorganisms exposed to wastewater with a protected reference population, detects when they diverge, and explains the evidence to an operator.

*Listen today. A cleaner tomorrow.*

## Run it locally

Needs [uv](https://docs.astral.sh/uv/) and Node 20 or newer. No Docker, PostgreSQL or Redis required.

```sh
scripts/setup.sh   # install, migrate, load 30 days of simulated data
scripts/dev.sh     # API on 8710, simulated devices, web app on http://127.0.0.1:5710
```

Sign in with **Use the demo account** on the login page (`operator@biocanary.demo` / `listen-today`).

| Station | Source | Shows |
|---|---|---|
| BC-S01 Influent channel | Simulated | An ongoing moderate inhibition event |
| BC-S02 Equalisation basin | Simulated | Healthy, with a past reference-chamber disturbance |
| BC-S03 Industrial discharge line | Simulated | Offline |
| BC-L01 Pilot rig | Live hardware | Empty until a real device connects |

Trigger a new simulated event at any time. The simulated response builds over 45 minutes, and the default 60-minute assessment median needs about 30 minutes of abnormal readings, so expect the status to change 40 to 60 minutes later. A shorter assessment window in the protocol reacts sooner and is noisier.

```sh
cd backend && .venv/bin/python -m app.simulation.device --trigger BC-S02 --peak 60 --kind ph --hours 3
```

To start over, stop the stack, delete `backend/var/biocanary.db*` and run `scripts/setup.sh` again.

## How it fits together

```
device ──HTTPS──▶ ingestion API ──▶ RDS (measurements) ──▶ analysis ──▶ assessments, alerts
                      │                                      │
                      └──▶ Redis (live state, events)        └──▶ ModelArts (classifier)
browser ◀── REST + server-sent events ── API on ECS ──▶ OBS (raw archives, reports, datasets)
```

| Path | Contents |
|---|---|
| `backend/app/ingest` | Device authentication, validation, data quality |
| `backend/app/analysis` | Indicator, anomaly detection, classification, factors, explanation |
| `backend/app/cloud` | Adapters for RDS, Redis/DCS, OBS, ModelArts and live connection probes |
| `backend/app/simulation` | Simulator engine, demo data, simulated device client |
| `backend/app/reports` | Report summary, PDF, CSV |
| `frontend/src` | React application: Dashboard, Facility (3D plant), Monitoring, AI Analysis, Reports |
| `device3d` | Blender model of the device, its build scripts and renders |
| `ml` | Dataset builder, MindSpore training, ModelArts inference container |
| `deploy` | Docker Compose, nginx and environment template for ECS |

## Documentation

- [Architecture and database](docs/architecture.md)
- [Hardware ingestion API](docs/hardware-api.md)
- [AI and measurement method](docs/ai.md)
- [Huawei Cloud deployment](docs/deployment-huawei-cloud.md)
- [Design system](docs/design-system.md)
- Interactive API reference: `/api/docs` on a running server

## Tests

```sh
cd backend && .venv/bin/python -m pytest -q
BIOCANARY_DATABASE_URL=postgresql+psycopg://... .venv/bin/python -m pytest -q   # destructive: use an empty database
cd frontend && npm run build
```

## Rules the code enforces

1. **Simulated and hardware data never mix.** Origin is fixed per station and stored on every measurement, assessment, alert and report. It is shown on every screen and in every export.
2. **No invented method.** The inhibition formula, activity source and class boundaries belong to an editable, versioned protocol.
3. **No unvalidated severity.** Hardware data is classified only by a validated protocol or a model trained on experimental data. Otherwise the result is "Unclassified".
4. **No false cloud status.** A Huawei service is shown as connected only after a live probe succeeds.
5. **No hidden fallback.** If ModelArts is selected and fails, the assessment says so.
6. **Correlation is labelled as correlation.** The platform never declares wastewater safe or unsafe.
