"""Current station state: served from the cache, rebuilt from the database when absent."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..cloud.registry import get_cache
from ..db import utcnow
from ..ingest.service import last_reading_at
from ..models import Alert, Assessment, Measurement, Station
from .alerts import offline_cutoff

STATUS_LABEL = {"healthy": "Healthy", "warning": "Warning", "critical": "Critical", "offline": "Offline", "pending": "Awaiting baseline"}
RISK = {"normal": "Low", "mild": "Elevated", "moderate": "High", "severe": "Very high"}


def _key(station_id: int) -> str:
    return f"station:{station_id}:state"


def invalidate(station_id: int) -> None:
    get_cache().delete(_key(station_id))


def derive_status(a: Assessment | None, last: datetime | None, station: Station, now: datetime) -> tuple[str, str]:
    if last is None:
        return "offline", "No readings have been received from this station yet."
    if now - last > offline_cutoff(station):
        return "offline", "No recent readings. The current biological condition is unknown."
    if a is None:
        return "pending", "Readings are arriving; the first assessment is not complete."
    text = a.detail["explanation"]["headline"]
    if a.severity == "severe":
        return "critical", text
    if a.severity in ("mild", "moderate", "inconclusive"):
        return "warning", text
    if a.severity == "insufficient":
        return ("pending", text) if not a.detail["signals"]["baseline_ready"] else ("warning", text)
    if a.severity == "unclassified":
        if a.anomaly:
            return "warning", text
        return ("healthy", text) if a.detail["signals"]["baseline_ready"] else ("pending", text)
    return "healthy", text


def build_state(db: Session, station: Station) -> dict:
    last = last_reading_at(db, station)
    newest = (
        select(Measurement.sensor_id, func.max(Measurement.recorded_at).label("at"))
        .where(Measurement.station_id == station.id)
        .group_by(Measurement.sensor_id)
        .subquery()
    )
    rows = db.scalars(
        select(Measurement).join(newest, (Measurement.sensor_id == newest.c.sensor_id) & (Measurement.recorded_at == newest.c.at))
    ).all()
    latest = {
        m.sensor_id: {"value": m.value, "quality": m.quality, "reason": m.quality_reason, "recorded_at": m.recorded_at.isoformat()} for m in rows
    }
    a = db.scalar(select(Assessment).where(Assessment.station_id == station.id).order_by(Assessment.slot.desc()).limit(1))
    return {
        "last_reading_at": last.isoformat() if last else None,
        "assessment_id": a.id if a else None,
        "sensors": [
            {
                "code": s.code, "name": s.name, "location": s.location, "quantity": s.quantity, "unit": s.unit,
                "valid_min": s.valid_min, "valid_max": s.valid_max, "latest": latest.get(s.id),
            }
            for s in station.sensors
            if s.active
        ],
        "devices": [
            {"code": d.code, "state": d.state, "firmware": d.firmware, "faults": d.faults, "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None}
            for d in station.devices
            if d.active
        ],
        "open_alerts": db.scalar(select(func.count()).select_from(Alert).where(Alert.station_id == station.id, Alert.ended_at.is_(None))),
    }


def get_state(db: Session, station: Station) -> dict:
    cache = get_cache()
    state = cache.get(_key(station.id))
    if state is None:
        state = build_state(db, station)
        cache.set(_key(station.id), state, ttl=120)
    # Status depends on the clock, so it is derived on every read and never cached.
    a = db.get(Assessment, state["assessment_id"]) if state["assessment_id"] else None
    last = datetime.fromisoformat(state["last_reading_at"]) if state["last_reading_at"] else None
    now = utcnow()
    status, reason = derive_status(a, last, station, now)
    for s in state["sensors"]:
        s["connection"] = _connection(s["latest"], station, now)
    return {**state, "status": status, "status_label": STATUS_LABEL[status], "status_reason": reason}


def _connection(latest: dict | None, station: Station, now: datetime) -> str:
    if latest is None:
        return "never"
    if now - datetime.fromisoformat(latest["recorded_at"]) > offline_cutoff(station):
        return "offline"
    return {"valid": "ok", "suspect": "suspect", "invalid": "invalid", "missing": "missing"}[latest["quality"]]


def station_summary(db: Session, station: Station) -> dict:
    st = get_state(db, station)
    return {
        "code": station.code, "name": station.name, "description": station.description, "origin": station.origin,
        "facility": station.facility.name, "location": station.facility.location, "timezone": station.facility.timezone,
        "status": st["status"], "status_label": st["status_label"], "status_reason": st["status_reason"],
        "last_reading_at": st["last_reading_at"], "open_alerts": st["open_alerts"],
        "expected_interval_seconds": station.expected_interval_seconds,
    }
