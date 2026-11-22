# Hardware ingestion API

For firmware developers. Base path: `/api/v1/ingest`. JSON over HTTPS. A working reference client is `backend/app/simulation/device.py`.

## 1. Register the station

`BC-L01` exists in a demo database. For a new installation:

```sh
cd backend
.venv/bin/python -m app.cli create-station BC-L02 "Aeration tank inlet" --facility "Plant A" --timezone Asia/Manila --interval 600
.venv/bin/python -m app.cli add-sensor BC-L02 EXP-DO "Exposed dissolved oxygen" --location exposed --quantity dissolved_oxygen --unit mg/L --min 0 --max 20 --max-step 3
.venv/bin/python -m app.cli provision-device BC-L02 BC-DEV-02
```

`provision-device` prints the key once; only a hash is stored. Replace a lost key with `--rotate`.

Quantities the analysis understands: `biological_activity`, `dissolved_oxygen`, `temperature` (chambers); `ph`, `temperature`, `dissolved_oxygen`, `conductivity`, `flow` (environment). Other quantities are stored and listed.

## 2. Authenticate

Send both headers on every request.

```
X-Device-Id: BC-DEV-02
X-Device-Key: bck_...
```

A device can only write to its own station.

## 3. Read the configuration

`GET /ingest/config` returns the station, sensors, units, valid ranges, reporting interval and `last_reading_at`. Use the last value after a restart to decide which buffered readings to upload.

## 4. Send a reading

`POST /ingest/readings` ([example](examples/reading.json))

| Field | Required | Notes |
|---|---|---|
| `schema_version` | No | `"1.0"` |
| `station_id` | Yes | Must match the device |
| `recorded_at` | Yes | ISO 8601 **with timezone**. At most 5 minutes in the future and 45 days old |
| `sequence` | No | Device counter |
| `partial` | No | Default `false`: any registered sensor left out is recorded as missing. Set `true` if you send chambers separately |
| `device_status` | No | `state` (`ok`, `degraded`, `fault`), `firmware`, `faults` |
| `measurements[]` | Yes | Up to 64 |
| `measurements[].sensor_id` | Yes | As registered |
| `measurements[].value` | Yes | Number, or `null` when the sensor gave nothing |
| `measurements[].unit`, `.location` | No | Rejected if they contradict the registration |
| `measurements[].status` | No | `ok`, `fault`, `missing`, `calibrating` |

Unknown fields are refused, so a misspelt field is noticed.

Response `202`:

```json
{
  "recorded_at": "2026-11-23T01:20:00Z", "accepted": true, "stored": 9, "reason": "",
  "measurements": [
    { "sensor_id": "REF-ACT", "result": "stored", "quality": "valid", "reason": "" },
    { "sensor_id": "ENV-TEMP", "result": "stored", "quality": "invalid", "reason": "below the valid range (0 °C)" },
    { "sensor_id": "ENV-DO", "result": "stored", "quality": "missing", "reason": "no value reported" }
  ]
}
```

| `quality` | Meaning | Used in analysis |
|---|---|---|
| `valid` | Within range | Yes |
| `suspect` | Jumped by more than the sensor's maximum step since the last reading. A change that persists becomes valid | No |
| `invalid` | Out of range, sensor fault or calibrating | No |
| `missing` | No value | No |

Nothing is interpolated. Gaps stay gaps in charts and reduce the valid share reported with each assessment.

## 5. Send buffered readings

`POST /ingest/batch` ([example](examples/batch.json)), up to 500 readings. Each is accepted or rejected separately.

## 6. Report status without a reading

`POST /ingest/status` ([example](examples/status.json)) returns `204`.

## Retrying

Every submission is safe to repeat. A timestamp already stored for a sensor is reported as `duplicate` and not changed.

| Status | Meaning | Action |
|---|---|---|
| 202 | Processed | Check per-measurement results |
| 401 | Unknown device or wrong key | Stop and report |
| 413 | Batch too large | Split it |
| 422 | Invalid payload | Fix it; do not retry unchanged |
| 5xx or no response | Server or network | Buffer and retry with backoff |

## Try it

```sh
curl -X POST http://127.0.0.1:8710/api/v1/ingest/readings \
  -H "X-Device-Id: BC-DEV-01" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d @docs/examples/reading.json
```

Set `recorded_at` to the current time first.
