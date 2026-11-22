"""Periodic work: connectivity checks and daily archiving of raw measurements to object storage."""

import asyncio
import csv
import gzip
import io
import logging
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .cloud.registry import get_cache, get_objects
from .db import SessionLocal, utcnow
from .ingest.service import last_reading_at
from .models import ArchiveObject, Measurement, Sensor, Station
from .services import state
from .services.alerts import update_connectivity

log = logging.getLogger("biocanary.worker")


def check_connectivity() -> None:
    with SessionLocal() as db:
        for st in db.scalars(select(Station)):
            if update_connectivity(db, st, utcnow(), last_reading_at(db, st)):
                db.commit()
                state.invalidate(st.id)
                get_cache().publish({"type": "alert", "station": st.code})
        db.commit()


def archive_day(db: Session, st: Station, day: datetime) -> ArchiveObject | None:
    start = datetime.combine(day.date(), time.min, UTC)
    key_day = f"{start:%Y-%m-%d}"
    if db.scalar(select(ArchiveObject).where(ArchiveObject.station_id == st.id, ArchiveObject.day == key_day)):
        return None
    rows = db.execute(
        select(Measurement.recorded_at, Measurement.received_at, Sensor.code, Sensor.location, Sensor.quantity, Sensor.unit, Measurement.value, Measurement.quality, Measurement.quality_reason, Measurement.origin)
        .join(Sensor, Sensor.id == Measurement.sensor_id)
        .where(Measurement.station_id == st.id, Measurement.recorded_at >= start, Measurement.recorded_at < start + timedelta(days=1))
        .order_by(Measurement.recorded_at, Sensor.id)
    ).all()
    if not rows:
        return None
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["recorded_at", "received_at", "sensor", "location", "quantity", "unit", "value", "quality", "reason", "origin"])
    w.writerows([r[0].isoformat(), r[1].isoformat(), *r[2:]] for r in rows)
    key = f"raw/{st.origin}/{st.code}/{start:%Y/%m}/{key_day}.csv.gz"
    store = get_objects()
    store.put(key, gzip.compress(out.getvalue().encode()), "application/gzip")
    a = ArchiveObject(station_id=st.id, day=key_day, object_key=key, object_provider=store.provider, rows=len(rows))
    db.add(a)
    db.commit()
    return a


def archive_recent(days: int = 2) -> None:
    with SessionLocal() as db:
        for st in db.scalars(select(Station)).all():
            for d in range(1, days + 1):
                archive_day(db, st, utcnow() - timedelta(days=d))


async def run_forever() -> None:
    tick = 0
    while True:
        # With several API instances, the cache lock lets one of them do each round.
        try:
            if await asyncio.to_thread(get_cache().lock, "worker:connectivity", 25):
                await asyncio.to_thread(check_connectivity)
            if tick % 60 == 1 and await asyncio.to_thread(get_cache().lock, "worker:archive", 600):
                await asyncio.to_thread(archive_recent)
        except Exception:
            log.exception("background round failed")
        tick += 1
        await asyncio.sleep(30)
