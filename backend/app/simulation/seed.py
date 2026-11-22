"""Creates the demonstration facility: simulated history plus one empty station for real hardware."""

import json
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from ..analysis.protocol import DEFAULT_CONFIG
from ..config import BACKEND_DIR, get_settings
from ..db import utcnow
from ..ingest.service import judge, last_reading_at
from ..models import Device, Facility, Measurement, ProcessEvent, Protocol, Sensor, Station, User
from ..schemas import MeasurementIn
from ..security import hash_device_key, hash_password, new_device_key
from ..services.alerts import update_connectivity
from ..services.assessments import run_assessment
from ..services.data import load_frame
from . import engine

INTERVAL = 600
KEY_FILE = BACKEND_DIR / "var" / "simulator-keys.json"


def ensure_demo_user(db: Session) -> None:
    s = get_settings()
    if not db.scalar(select(User).where(User.email == s.demo_user)):
        db.add(User(email=s.demo_user, name="Demo Operator", role="admin", password_hash=hash_password(s.demo_password)))
        db.commit()


def add_sensors(station: Station, only: list[str] | None = None) -> None:
    for code, name, loc, q, unit, lo, hi, step in engine.SENSORS:
        if only is None or code in only:
            station.sensors.append(Sensor(code=code, name=name, location=loc, quantity=q, unit=unit, valid_min=lo, valid_max=hi, max_step=step))


def seed_demo(db: Session, days: int | None = None, log=print) -> bool:
    ensure_demo_user(db)
    if db.scalar(select(Station).limit(1)):
        return False
    now = utcnow()
    days = days or get_settings().demo_history_days
    facility = Facility(name="Demonstration Facility", location="Simulated site", timezone="Asia/Manila")
    demo = Protocol(
        name="Demonstration protocol", version="1", validation_status="demonstration",
        validation_reference="Class boundaries chosen to exercise the software with simulated data. Not experimentally derived.",
        config={**DEFAULT_CONFIG, "thresholds": {"mild": 10.0, "moderate": 25.0, "severe": 50.0}},
    )
    pilot = Protocol(
        name="Pilot rig protocol", version="1", validation_status="unvalidated",
        validation_reference="Pending. Enter thresholds here once dose-response experiments on the actual device are complete.",
        config=DEFAULT_CONFIG,
    )
    db.add_all([facility, demo, pilot])
    db.flush()

    iso = lambda h: (now - timedelta(hours=h)).isoformat()  # noqa: E731
    quiet = {"quiet_from": iso(60), "quiet_to": iso(-30)}
    stations = [
        Station(
            code="BC-S01", name="Influent channel", origin="simulated", description="Raw influent ahead of primary treatment.",
            facility=facility, protocol=demo, expected_interval_seconds=INTERVAL,
            sim_profile={
                "seed": 4107, "level": 42.0, "event_rate": 0.22, **quiet,
                "events": [
                    {"start": iso(4.2), "hours": 14, "peak": 37, "kind": "conductivity", "lead_minutes": 45},
                    {"start": iso(27), "hours": 3.0, "peak": 16, "kind": "unattributed"},
                ],
            },
        ),
        Station(
            code="BC-S02", name="Equalisation basin", origin="simulated", description="Blended flow after equalisation.",
            facility=facility, protocol=demo, expected_interval_seconds=INTERVAL,
            sim_profile={
                "seed": 9127, "level": 38.5, "event_rate": 0.1, "chamber_offset": 1.0, **quiet, "events": [],
                "reference_disturbances": [{"start": iso(24 * 6.4), "hours": 5, "drop": 24}],
            },
        ),
        Station(
            code="BC-S03", name="Industrial discharge line", origin="simulated", description="Trade effluent connection.",
            facility=facility, protocol=demo, expected_interval_seconds=INTERVAL,
            sim_profile={"seed": 5531, "level": 45.0, "event_rate": 0.3, **quiet, "events": [], "stop_at": iso(6.5)},
        ),
    ]
    live = Station(
        code="BC-L01", name="Pilot rig", origin="live", description="Reserved for the BIOCANARY hardware prototype.",
        facility=facility, protocol=pilot, expected_interval_seconds=INTERVAL,
    )
    for st in stations:
        add_sensors(st)
    add_sensors(live, [c for c in engine.CODES if c not in ("ENV-COND", "ENV-FLOW")])
    db.add_all([*stations, live])
    db.flush()

    keys = {}
    for st in stations:
        key = new_device_key()
        keys[st.code] = {"device_id": f"{st.code}-SIM", "key": key}
        db.add(Device(code=f"{st.code}-SIM", station_id=st.id, key_hash=hash_device_key(key), state="ok", firmware="simulator"))
    db.commit()
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(json.dumps(keys, indent=1))
    KEY_FILE.chmod(0o600)

    start = now - timedelta(days=days)
    for st in stations:
        end = datetime.fromisoformat(st.sim_profile["stop_at"]) if st.sim_profile.get("stop_at") else now
        count = _history(db, st, start, end)
        n = _assess_history(db, st, start + timedelta(days=2), end)
        st.devices[0].last_seen_at = end
        db.commit()
        log(f"  {st.code}  {count} simulated measurements, {n} assessments")
    for st in stations:
        for ev in engine.scheduled_events(st.sim_profile, start, now):
            if ev.kind in ("flow", "conductivity") and start < ev.start < now:
                db.add(
                    ProcessEvent(
                        station_id=st.id, occurred_at=ev.start - timedelta(minutes=ev.lead_minutes + 10), kind="discharge",
                        note="Batch discharge notified by upstream connection (simulated)", origin="simulated", recorded_by="simulator",
                    )
                )
    db.add(ProcessEvent(station_id=stations[0].id, occurred_at=now - timedelta(hours=9), kind="sampling", note="Routine grab sample (simulated)", origin="simulated", recorded_by="simulator"))
    db.commit()
    for st in stations:
        update_connectivity(db, st, utcnow(), last_reading_at(db, st))
        run_assessment(db, st)  # pick up the events recorded above
    db.commit()
    return True


def _history(db: Session, st: Station, start: datetime, end: datetime) -> int:
    times = engine.grid_times(start, end, INTERVAL)
    values, _ = engine.generate(st.sim_profile, times)
    rows = []
    for sensor in st.sensors:
        previous = None
        for at, v in zip(times, values[sensor.code], strict=True):
            m = MeasurementIn(sensor_id=sensor.code, value=None if np.isnan(v) else float(v))
            value, quality, why = judge(m, sensor, previous, at, INTERVAL)
            if quality in ("valid", "suspect"):
                previous = (at, value)
            rows.append(
                dict(station_id=st.id, sensor_id=sensor.id, recorded_at=at, received_at=at, value=value, quality=quality, quality_reason=why, origin="simulated")
            )
    for i in range(0, len(rows), 5000):
        db.execute(insert(Measurement), rows[i : i + 5000])
    db.commit()
    return len(rows)


def _assess_history(db: Session, st: Station, start: datetime, end: datetime) -> int:
    full = load_frame(db, st, start - timedelta(days=2), end)
    n = 0
    for at in pd.date_range(pd.Timestamp(start).ceil("30min"), pd.Timestamp(end).floor("10min"), freq="30min"):
        run_assessment(db, st, at.to_pydatetime(), full.loc[at - pd.Timedelta(days=7, hours=9) : at])
        n += 1
    return n
