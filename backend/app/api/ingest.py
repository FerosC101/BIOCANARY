from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError

from ..cloud.registry import get_cache
from ..config import get_settings
from ..db import SessionLocal, utcnow
from ..ingest.service import Ingestor, last_reading_at
from ..models import Station
from ..schemas import BatchIn, ReadingIn, ReadingResult, StatusIn
from ..services import state
from ..services.alerts import update_connectivity
from ..services.assessments import run_assessment
from .deps import CurrentDevice, Db

router = APIRouter(prefix="/ingest", tags=["Device ingestion"])


def after_ingest(station_id: int, code: str, slots: list) -> None:
    """Runs after the device has its response: assess, update alerts, refresh the cache, notify clients."""
    cache = get_cache()
    with SessionLocal() as db:
        station = db.get(Station, station_id)
        alert_changed = False
        for at in slots:
            try:
                record = run_assessment(db, station, at)
            except IntegrityError:  # another request stored this slot first; update that record instead
                db.rollback()
                record = run_assessment(db, station, at)
            alert_changed |= bool(record and record.alert_changed)
        alert_changed |= update_connectivity(db, station, utcnow(), last_reading_at(db, station))
        db.commit()
    state.invalidate(station_id)
    cache.publish({"type": "alert" if alert_changed else "reading", "station": code})


def _finish(db, device, results: list[ReadingResult], tasks: BackgroundTasks) -> None:
    db.commit()
    stored = sorted(r.recorded_at for r in results if r.stored)
    if not stored:
        return
    # One assessment per 30 minutes of a backfilled batch, and always the newest reading.
    slots, last = [], None
    for at in stored:
        if last is None or (at - last).total_seconds() >= 1800:
            slots.append(at)
            last = at
    if slots[-1] != stored[-1]:
        slots.append(stored[-1])
    state.invalidate(device.station_id)
    tasks.add_task(after_ingest, device.station_id, device.station.code, slots)


@router.post("/readings", response_model=ReadingResult, status_code=202)
def ingest_reading(body: ReadingIn, device: CurrentDevice, db: Db, tasks: BackgroundTasks):
    """Submit one timestamped reading. Safe to retry: a repeated timestamp is reported as a duplicate."""
    result = Ingestor(db, device).reading(body)
    if not result.accepted and not result.measurements:
        db.rollback()
        raise HTTPException(422, result.reason)
    _finish(db, device, [result], tasks)
    return result


@router.post("/batch", response_model=list[ReadingResult], status_code=202)
def ingest_batch(body: BatchIn, device: CurrentDevice, db: Db, tasks: BackgroundTasks):
    """Submit buffered readings after a connectivity gap. Each reading is accepted or rejected on its own."""
    limit = get_settings().max_batch_readings
    if len(body.readings) > limit:
        raise HTTPException(413, f"Send at most {limit} readings per batch.")
    ing = Ingestor(db, device)
    results = []
    for r in sorted(body.readings, key=lambda x: x.recorded_at.timestamp()):
        results.append(ing.reading(r))
        db.flush()
    _finish(db, device, results, tasks)
    return results


@router.post("/status", status_code=204)
def ingest_status(body: StatusIn, device: CurrentDevice, db: Db):
    """Heartbeat or fault report without measurements."""
    if body.station_id != device.station.code:
        raise HTTPException(422, "This device is not assigned to that station.")
    Ingestor(db, device).status(body.device_status)
    db.commit()
    state.invalidate(device.station_id)
    get_cache().publish({"type": "reading", "station": device.station.code})


@router.get("/config")
def ingest_config(device: CurrentDevice, db: Db):
    """What the device should send: its station, sensors, units, valid ranges and interval."""
    st = device.station
    last = last_reading_at(db, st)
    return {
        "station_id": st.code,
        "origin": st.origin,
        "interval_seconds": st.expected_interval_seconds,
        "last_reading_at": last.isoformat() if last else None,
        "sensors": [
            {"sensor_id": s.code, "location": s.location, "quantity": s.quantity, "unit": s.unit, "valid_min": s.valid_min, "valid_max": s.valid_max}
            for s in st.sensors
            if s.active
        ],
    }
