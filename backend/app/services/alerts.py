"""Alert lifecycle. Alerts open on persistence and close only after the condition stays clear."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.explain import SEVERITY_LABEL
from ..config import get_settings
from ..models import Alert, Assessment, Measurement, Sensor, Station

CLEAR_AFTER = timedelta(minutes=30)
PERSIST_WITHIN = timedelta(minutes=45)
SENSOR_SILENT = timedelta(minutes=60)
RANK = {"mild": 1, "moderate": 2, "severe": 3}


def open_alert(db: Session, station_id: int, kind: str) -> Alert | None:
    return db.scalar(
        select(Alert).where(Alert.station_id == station_id, Alert.kind == kind, Alert.ended_at.is_(None)).order_by(Alert.id.desc()).limit(1)
    )


def _condition(result: dict) -> str | None:
    sev = result["severity"]
    if sev in RANK:
        return "inhibition"
    if sev == "inconclusive":
        return "reference"
    if sev == "unclassified" and result["anomaly"]:
        return "anomaly"
    return None


def update_from_assessment(db: Session, station: Station, result: dict, at: datetime, record: Assessment) -> bool:
    """Applies one assessment to the biological alerts. Returns True when anything changed."""
    active = _condition(result)
    changed = False
    for kind in ("inhibition", "reference", "anomaly"):
        alert = open_alert(db, station.id, kind)
        if kind == active:
            sev = result["severity"]
            inh = result["signals"]["inhibition"]
            if alert is None:
                previous = db.scalar(
                    select(Assessment)
                    .where(Assessment.station_id == station.id, Assessment.slot < record.slot, Assessment.slot >= record.slot - PERSIST_WITHIN)
                    .order_by(Assessment.slot.desc())
                    .limit(1)
                )
                confirmed = previous is not None and _condition(previous.detail) == kind
                # A severe response does not wait for a second assessment.
                if not confirmed and sev != "severe":
                    continue
                alert = Alert(
                    station_id=station.id,
                    kind=kind,
                    level="warning",
                    title="",
                    message="",
                    origin=station.origin,
                    started_at=previous.data_until if confirmed else at,
                    last_seen_at=at,
                )
                db.add(alert)
                changed = True
            alert.last_seen_at, alert.clear_since = at, None
            if kind == "inhibition":
                if RANK[sev] > RANK.get(alert.severity, 0):
                    alert.severity, changed = sev, True
                    alert.message = result["explanation"]["summary"]
                alert.level = "critical" if alert.severity == "severe" else "warning"
                alert.title = SEVERITY_LABEL[alert.severity]
                if inh is not None and inh > (alert.peak_inhibition if alert.peak_inhibition is not None else -1e9):
                    alert.peak_inhibition = inh
                    alert.message = result["explanation"]["summary"]
            else:
                alert.title = result["explanation"]["headline"]
                alert.message = result["explanation"]["summary"]
                alert.peak_inhibition = inh if kind == "anomaly" else None
        elif alert is not None:
            if alert.clear_since is None:
                alert.clear_since = at
            elif at - alert.clear_since >= CLEAR_AFTER:
                alert.ended_at, changed = alert.clear_since, True
    return changed


def offline_cutoff(station: Station) -> timedelta:
    return max(timedelta(minutes=get_settings().offline_after_minutes), timedelta(seconds=station.expected_interval_seconds * 2.5))


def update_connectivity(db: Session, station: Station, now: datetime, last_reading: datetime | None) -> bool:
    """Opens and closes offline and silent-sensor alerts."""
    if last_reading is None:
        return False
    changed = False
    offline = now - last_reading > offline_cutoff(station)
    alert = open_alert(db, station.id, "offline")
    if offline and alert is None:
        db.add(
            Alert(
                station_id=station.id, kind="offline", level="warning", title="Station offline", origin=station.origin,
                message="No readings are being received. The current biological condition is unknown.",
                started_at=last_reading, last_seen_at=now,
            )
        )
        changed = True
    elif offline and alert:
        alert.last_seen_at = now
    elif alert:
        alert.ended_at, changed = now, True

    alert = open_alert(db, station.id, "sensor")
    silent = [] if offline else silent_sensors(db, station, now)
    if silent:
        text = ", ".join(s.name for s in silent)
        if alert is None:
            alert = Alert(station_id=station.id, kind="sensor", level="warning", title="Sensor not reporting valid data", message="", origin=station.origin, started_at=now, last_seen_at=now)
            db.add(alert)
            changed = True
        alert.message, alert.last_seen_at = f"No valid reading for over an hour: {text}.", now
    elif alert:
        alert.ended_at, changed = now, True
    return changed


def silent_sensors(db: Session, station: Station, now: datetime) -> list[Sensor]:
    reporting = set(
        db.scalars(
            select(Measurement.sensor_id)
            .where(Measurement.station_id == station.id, Measurement.recorded_at >= now - SENSOR_SILENT, Measurement.quality.in_(("valid", "suspect")))
            .distinct()
        )
    )
    return [s for s in station.sensors if s.active and s.id not in reporting]
