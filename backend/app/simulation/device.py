"""Simulated device. Sends readings to the public ingestion API exactly as firmware would.

    python -m app.simulation.device --interval 20
    python -m app.simulation.device --trigger BC-S02 --peak 60 --kind ph --hours 3

It doubles as a reference client: authentication, buffering of unsent readings and batch upload.
"""

import argparse
import json
import math
import os
import time
from datetime import UTC, datetime, timedelta

import httpx

from .engine import CODES, SENSORS, generate, grid_times
from .seed import INTERVAL, KEY_FILE

UNITS = {s[0]: (s[4], s[2]) for s in SENSORS}


def payload(station: str, profile: dict, at: datetime, sequence: int) -> dict:
    values, _ = generate(profile, [at])
    return {
        "schema_version": "1.0",
        "station_id": station,
        "recorded_at": at.isoformat(),
        "sequence": sequence,
        "device_status": {"state": "ok", "firmware": "simulator", "faults": []},
        "measurements": [
            {
                "sensor_id": c,
                "value": None if math.isnan(values[c][0]) else float(values[c][0]),
                "unit": UNITS[c][0],
                "location": UNITS[c][1],
                "status": "missing" if math.isnan(values[c][0]) else "ok",
            }
            for c in CODES
        ],
    }


def profiles() -> dict[str, dict]:
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Station

    with SessionLocal() as db:
        return {s.code: s.sim_profile for s in db.scalars(select(Station).where(Station.origin == "simulated"))}


def trigger(station: str, peak: float, kind: str, hours: float) -> None:
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Station

    with SessionLocal() as db:
        st = db.scalar(select(Station).where(Station.code == station, Station.origin == "simulated"))
        if not st:
            raise SystemExit(f"{station} is not a simulated station")
        event = {"start": datetime.now(UTC).isoformat(), "hours": hours, "peak": peak, "kind": kind}
        st.sim_profile = {**st.sim_profile, "events": [*st.sim_profile.get("events", []), event]}
        db.commit()
    print(f"{station}: simulated {kind} event scheduled now, peak {peak:g}% over {hours:g} h")


def run(base: str, interval: int) -> None:
    keys = json.loads(KEY_FILE.read_text())
    client = httpx.Client(base_url=base, timeout=30)
    sequence, caught_up = int(time.time()), set()
    print(f"Simulated devices -> {base} every {interval}s (origin=simulated)", flush=True)
    while True:
        now = datetime.now(UTC).replace(microsecond=0)
        for code, profile in profiles().items():
            if profile.get("stop_at") or code not in keys:
                continue
            headers = {"X-Device-Id": keys[code]["device_id"], "X-Device-Key": keys[code]["key"]}
            try:
                if code not in caught_up:
                    last = client.get("/api/v1/ingest/config", headers=headers).raise_for_status().json()["last_reading_at"]
                    begin = max(datetime.fromisoformat(last) + timedelta(seconds=1), now - timedelta(days=40)) if last else now
                    missed = grid_times(begin, now, INTERVAL)
                    for i in range(0, len(missed), 100):
                        body = {"readings": [payload(code, profile, t, sequence) for t in missed[i : i + 100]]}
                        client.post("/api/v1/ingest/batch", json=body, headers=headers).raise_for_status()
                    if missed:
                        print(f"{code}: uploaded {len(missed)} buffered readings", flush=True)
                    caught_up.add(code)
                sequence += 1
                client.post("/api/v1/ingest/readings", json=payload(code, profile, now, sequence), headers=headers).raise_for_status()
            except httpx.HTTPError as exc:
                caught_up.discard(code)  # re-upload the gap once the API is reachable
                print(f"{code}: {type(exc).__name__}: {exc}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("BIOCANARY_API", "http://127.0.0.1:8710"))
    ap.add_argument("--interval", type=int, default=20)
    ap.add_argument("--trigger", metavar="STATION")
    ap.add_argument("--peak", type=float, default=60)
    ap.add_argument("--kind", choices=("conductivity", "ph", "flow", "unattributed"), default="conductivity")
    ap.add_argument("--hours", type=float, default=3)
    a = ap.parse_args()
    trigger(a.trigger, a.peak, a.kind, a.hours) if a.trigger else run(a.base_url, a.interval)
