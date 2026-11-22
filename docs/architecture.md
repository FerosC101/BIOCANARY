# Architecture

## Components

| Component | Local | Huawei Cloud | Adapter |
|---|---|---|---|
| API, ingestion, analysis workflow | uvicorn process | ECS | `app/main.py` |
| Relational data | SQLite (or any PostgreSQL) | RDS for PostgreSQL | SQLAlchemy URL |
| Live state, event fan-out, locks, sign-in limits | In-process | DCS (Redis) | `app/cloud/cache.py` |
| Raw archives, reports, datasets | `backend/var/objects` | OBS | `app/cloud/objects.py` |
| Classifier inference | In-process numpy | ModelArts real-time service | `app/cloud/inference.py` |

Each is chosen independently by environment variable, so a deployment can move one service at a time.

## Operating modes

Two independent facts are always shown.

**Data source**, per station: *Simulated data* or *Live hardware*.

**Infrastructure**, for the deployment, from probes refreshed every 30 seconds:

| Label | Meaning |
|---|---|
| Local development | No Huawei provider selected |
| Huawei Cloud connected | All five services selected and every probe succeeded |
| Huawei Cloud: n of 5 services | Some probes succeeded |
| Huawei Cloud configured, not connected | Selected, none reachable |

Probes: ECS metadata endpoint, RDS query, Redis `PING`, OBS `HeadBucket`, ModelArts `/health`.

## Data flow

1. A device posts a reading. Each value is judged valid, suspect, invalid or missing and stored either way.
2. The device receives `202`. The station is then assessed, alerts are updated and the cached state is cleared.
3. A message is published. Browsers connected to `/api/v1/stream` refetch the affected station.
4. A background worker checks connectivity every 30 seconds and writes daily raw archives to object storage. A cache lock ensures one worker per round across several API instances.

## Database

| Table | Purpose |
|---|---|
| `users` | Operators and administrators (argon2 password hashes) |
| `facilities` | Site and timezone |
| `stations` | Code, **origin**, protocol, expected interval |
| `protocols` | Activity source, formula, thresholds, validation status and record, version |
| `devices` | Hashed key, state, faults, last contact |
| `sensors` | Location (reference, exposed, environment), quantity, unit, valid range, maximum step |
| `measurements` | Value, quality and reason, recorded and received time, origin. Unique per sensor and timestamp |
| `process_events` | Logged sampling, discharge and maintenance |
| `assessments` | One per station per 10-minute slot: severity, indicator, confidence, protocol and model versions, full evidence |
| `alerts` | Inhibition, anomaly, reference, sensor and offline episodes with acknowledgement |
| `reports` | Report metadata and object key |
| `archive_objects` | Raw archive files written to object storage |

Timestamps are UTC. Schema changes go through Alembic: `cd backend && .venv/bin/alembic revision --autogenerate -m "..."`.

## Station status

| Status | When |
|---|---|
| Healthy | Classified normal; or, without validated thresholds, no unusual difference from the station's own history |
| Warning | Mild or moderate inhibition, unusual response, changed reference chamber, or too few valid readings |
| Critical | Severe inhibition |
| Offline | No reading for the longer of 30 minutes and 2.5 reporting intervals |
| Awaiting baseline | Readings are arriving but there is not enough history. Added so a new station is not shown as Healthy |

Biological alerts open after two consecutive abnormal assessments (severe opens at once) and close after 30 minutes clear.

## Main endpoints

All under `/api/v1`; session cookie required unless noted. Full schemas at `/api/docs`.

| Endpoint | Purpose |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session |
| `GET /stations`, `GET /stations/{code}/overview` | Station list, dashboard |
| `GET /stations/{code}/series` | Chart series and inhibition indicator |
| `GET /stations/{code}/readings`, `/sensors` | Individual readings, connectivity and quality |
| `GET, POST /stations/{code}/events` | Logged events |
| `GET /stations/{code}/analysis`, `/assessments`, `POST .../analysis/run` | AI analysis |
| `GET /stations/{code}/protocol`, `PUT /protocols/{id}` (administrator) | Measurement protocol |
| `GET /model` | Model card |
| `GET /stations/{code}/alerts`, `POST /alerts/{id}/acknowledge` | Alerts |
| `GET /stations/{code}/report`, `GET, POST /reports`, `GET /reports/{id}/download` | Reports |
| `GET /system/status`, `GET /stream` | Infrastructure state, live updates |
| `POST /ingest/*`, `GET /ingest/config` | Devices (device key). See [hardware API](hardware-api.md) |
