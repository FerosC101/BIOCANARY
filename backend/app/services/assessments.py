from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.pipeline import Context, assess
from ..cloud.registry import get_inference
from ..db import utcnow
from ..ingest.service import last_reading_at
from ..models import Assessment, ProcessEvent, Station
from . import alerts
from .data import analysis_start, load_frame

SLOT = timedelta(minutes=10)


def slot_of(at: datetime) -> datetime:
    return pd.Timestamp(at).floor("10min").to_pydatetime()


def make_context(db: Session, station: Station, at: datetime) -> Context:
    inference = get_inference()
    events = db.scalars(
        select(ProcessEvent).where(ProcessEvent.station_id == station.id, ProcessEvent.occurred_at <= at, ProcessEvent.occurred_at >= at - timedelta(days=3))
    ).all()
    return Context(
        origin=station.origin,
        protocol_config=station.protocol.config,
        validation_status=station.protocol.validation_status,
        predict=inference.predict,
        inference_backend=inference.provider,
        events=[{"occurred_at": e.occurred_at.isoformat(), "kind": e.kind, "note": e.note} for e in events],
    )


def run_assessment(db: Session, station: Station, at: datetime | None = None, frame: pd.DataFrame | None = None) -> Assessment | None:
    """Assesses the station at `at` (default: its newest reading) and stores the result for that slot."""
    at = at or last_reading_at(db, station)
    if at is None:
        return None
    if frame is None:
        frame = load_frame(db, station, analysis_start(station, at), at)
    result = assess(frame, pd.Timestamp(at).floor("10min"), make_context(db, station, at))
    slot = slot_of(at)
    record = db.scalar(select(Assessment).where(Assessment.station_id == station.id, Assessment.slot == slot))
    if record is None:
        record = Assessment(station_id=station.id, slot=slot, origin=station.origin)
        db.add(record)
    p = station.protocol
    result["data_until"] = at.isoformat()
    record.assessed_at, record.data_until = utcnow(), at
    record.severity, record.anomaly = result["severity"], result["anomaly"]
    record.inhibition, record.confidence = result["signals"]["inhibition"], result["confidence"]
    record.protocol_version = f"{p.name} v{p.version}"
    record.model_version = result["model"].get("version", "")
    record.inference_backend = result["model"].get("backend", "")
    record.detail = result
    db.flush()
    record_changed = alerts.update_from_assessment(db, station, result, at, record)
    db.commit()
    record.alert_changed = record_changed  # transient, read by the caller to decide what to publish
    return record
