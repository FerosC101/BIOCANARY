import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select

from ..analysis.explain import SEVERITY_LABEL
from ..analysis.protocol import ACTIVITY_SOURCES, FORMULAS, merged, validate
from ..cloud.registry import get_cache
from ..config import get_settings
from ..db import utcnow
from ..models import Alert, Assessment, Measurement, ProcessEvent, Protocol, Sensor, Station
from ..schemas import AckIn, EventIn, ProtocolIn
from ..services import state as st
from ..services.alerts import RANK
from ..services.assessments import run_assessment
from ..services.patterns import patterns
from ..services.series import station_series
from .deps import CurrentUser, Db, PeriodDep, StationDep, admin_user, aware

router = APIRouter(tags=["Stations"])


def alert_out(a: Alert) -> dict:
    return {
        "id": a.id, "kind": a.kind, "level": a.level, "severity": a.severity, "title": a.title, "message": a.message, "origin": a.origin,
        "started_at": a.started_at, "ended_at": a.ended_at, "last_seen_at": a.last_seen_at, "peak_inhibition": a.peak_inhibition,
        "acknowledged_at": a.acknowledged_at, "acknowledged_by": a.acknowledged_by, "acknowledge_note": a.acknowledge_note,
    }


def assessment_out(a: Assessment) -> dict:
    return {
        "id": a.id, "data_until": a.data_until, "assessed_at": a.assessed_at, "severity": a.severity, "severity_label": SEVERITY_LABEL[a.severity],
        "risk": st.RISK.get(a.severity, "Not rated"), "anomaly": a.anomaly, "inhibition": a.inhibition, "confidence": a.confidence, "origin": a.origin,
        "protocol_version": a.protocol_version, "model_version": a.model_version, "inference_backend": a.inference_backend, "detail": a.detail,
    }


@router.get("/stations")
def list_stations(db: Db, _: CurrentUser):
    return [st.station_summary(db, s) for s in db.scalars(select(Station).order_by(Station.id))]


@router.get("/stations/{code}/overview")
def overview(station: StationDep, db: Db, hours: int = Query(24, ge=3, le=168)):
    """Everything the dashboard needs, anchored to the newest reading so an offline station still shows its last state."""
    current = st.get_state(db, station)
    a = db.get(Assessment, current["assessment_id"]) if current["assessment_id"] else None
    alerts = db.scalars(
        select(Alert).where(Alert.station_id == station.id).order_by(Alert.ended_at.is_not(None), Alert.started_at.desc()).limit(6)
    ).all()
    end = aware(datetime.fromisoformat(current["last_reading_at"])) if current["last_reading_at"] else utcnow()
    return {
        "station": st.station_summary(db, station),
        "sensors": current["sensors"], "devices": current["devices"],
        "assessment": assessment_out(a) if a else None,
        "alerts": [alert_out(x) for x in alerts],
        "series": station_series(db, station, end - timedelta(hours=hours), end),
        "protocol_status": station.protocol.validation_status,
    }


@router.get("/stations/{code}/series")
def series(station: StationDep, db: Db, period: PeriodDep):
    return station_series(db, station, period.start, period.end)


@router.get("/stations/{code}/sensors")
def sensors(station: StationDep, db: Db, period: PeriodDep):
    """Connectivity now, and data completeness over the selected period."""
    current = st.get_state(db, station)
    counts: dict[str, dict[str, int]] = {}
    for code, quality, n in db.execute(
        select(Sensor.code, Measurement.quality, func.count())
        .join(Sensor, Sensor.id == Measurement.sensor_id)
        .where(Measurement.station_id == station.id, Measurement.recorded_at >= period.start, Measurement.recorded_at <= period.end)
        .group_by(Sensor.code, Measurement.quality)
    ):
        counts.setdefault(code, {})[quality] = n
    out = []
    for s in current["sensors"]:
        c = counts.get(s["code"], {})
        out.append({**s, "counts": {q: c.get(q, 0) for q in ("valid", "suspect", "invalid", "missing")}})
    return {"sensors": out, "devices": current["devices"], "last_reading_at": current["last_reading_at"]}


@router.get("/stations/{code}/readings")
def readings(
    station: StationDep, db: Db, period: PeriodDep, sensor: str | None = None, quality: str | None = Query(None, pattern="^(valid|suspect|invalid|missing|problem)$"),
    page: int = Query(1, ge=1), size: int = Query(25, ge=5, le=100),
):
    where = [Measurement.station_id == station.id, Measurement.recorded_at >= period.start, Measurement.recorded_at <= period.end]
    if sensor:
        where.append(Sensor.code == sensor)
    if quality == "problem":
        where.append(Measurement.quality != "valid")
    elif quality:
        where.append(Measurement.quality == quality)
    join = select(Measurement, Sensor).join(Sensor, Sensor.id == Measurement.sensor_id).where(*where)
    total = db.scalar(select(func.count(Measurement.id)).join(Sensor, Sensor.id == Measurement.sensor_id).where(*where))
    rows = db.execute(join.order_by(Measurement.recorded_at.desc(), Sensor.id).offset((page - 1) * size).limit(size)).all()
    return {
        "total": total, "page": page, "size": size,
        "rows": [
            {
                "id": m.id, "recorded_at": m.recorded_at, "received_at": m.received_at, "sensor": s.code, "name": s.name, "location": s.location,
                "unit": s.unit, "value": m.value, "quality": m.quality, "reason": m.quality_reason, "origin": m.origin,
            }
            for m, s in rows
        ],
    }


@router.get("/stations/{code}/events")
def list_events(station: StationDep, db: Db, period: PeriodDep):
    rows = db.scalars(
        select(ProcessEvent)
        .where(ProcessEvent.station_id == station.id, ProcessEvent.occurred_at >= period.start, ProcessEvent.occurred_at <= period.end)
        .order_by(ProcessEvent.occurred_at.desc())
    )
    return [{"id": e.id, "occurred_at": e.occurred_at, "kind": e.kind, "note": e.note, "origin": e.origin, "recorded_by": e.recorded_by} for e in rows]


@router.post("/stations/{code}/events", status_code=201)
def add_event(station: StationDep, body: EventIn, db: Db, user: CurrentUser):
    at = aware(body.occurred_at)
    if at > utcnow() + timedelta(minutes=5):
        raise HTTPException(422, "An event cannot be recorded in the future.")
    e = ProcessEvent(station_id=station.id, occurred_at=at, kind=body.kind, note=body.note.strip(), origin=station.origin, recorded_by=user.email)
    db.add(e)
    db.commit()
    return {"id": e.id}


@router.get("/stations/{code}/alerts")
def list_alerts(station: StationDep, db: Db, period: PeriodDep):
    rows = db.scalars(
        select(Alert).where(Alert.station_id == station.id, Alert.started_at <= period.end, func.coalesce(Alert.ended_at, period.end) >= period.start).order_by(Alert.started_at.desc()).limit(200)
    )
    return [alert_out(a) for a in rows]


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: int, body: AckIn, db: Db, user: CurrentUser):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found.")
    if not a.acknowledged_at:
        a.acknowledged_at, a.acknowledged_by, a.acknowledge_note = utcnow(), user.name, body.note.strip()
        db.commit()
        code = db.get(Station, a.station_id).code
        st.invalidate(a.station_id)
        get_cache().publish({"type": "alert", "station": code})
    return alert_out(a)


# --- AI analysis -------------------------------------------------------------------------


@router.get("/stations/{code}/analysis", tags=["AI analysis"])
def analysis(station: StationDep, db: Db, id: int | None = None):
    latest = db.scalar(select(Assessment).where(Assessment.station_id == station.id).order_by(Assessment.slot.desc()).limit(1))
    a = latest if id is None else db.scalar(select(Assessment).where(Assessment.id == id, Assessment.station_id == station.id))
    if id is not None and a is None:
        raise HTTPException(404, "Assessment not found.")
    if a is None:
        return {"assessment": None, "is_latest": True, "alert": None, "patterns": None}
    alert = None
    if a.severity in RANK or a.anomaly:
        alert = db.scalar(
            select(Alert)
            .where(Alert.station_id == station.id, Alert.kind.in_(("inhibition", "anomaly")), Alert.started_at <= a.data_until, func.coalesce(Alert.ended_at, utcnow()) >= a.data_until)
            .order_by(Alert.started_at.desc())
            .limit(1)
        )
    return {
        "assessment": assessment_out(a), "is_latest": a.id == latest.id, "alert": alert_out(alert) if alert else None,
        "patterns": patterns(db, station, a.data_until, 30, alert),
    }


@router.get("/stations/{code}/assessments", tags=["AI analysis"])
def assessments(station: StationDep, db: Db, period: PeriodDep, severity: str | None = None, limit: int = Query(500, ge=1, le=3000)):
    q = select(Assessment.id, Assessment.data_until, Assessment.severity, Assessment.anomaly, Assessment.inhibition, Assessment.confidence).where(
        Assessment.station_id == station.id, Assessment.data_until >= period.start, Assessment.data_until <= period.end
    )
    if severity:
        q = q.where(Assessment.severity.in_(severity.split(",")))
    rows = db.execute(q.order_by(Assessment.data_until.desc()).limit(limit)).all()
    return [dict(r._mapping) for r in rows]


@router.post("/stations/{code}/analysis/run", tags=["AI analysis"])
def run_now(station: StationDep, db: Db):
    a = run_assessment(db, station)
    if a is None:
        raise HTTPException(409, "This station has no measurements to assess yet.")
    st.invalidate(station.id)
    get_cache().publish({"type": "reading", "station": station.code})
    return assessment_out(a)


@router.get("/model", tags=["AI analysis"])
def model_card(_: CurrentUser):
    s = get_settings()
    path = Path(s.model_path)
    if not path.exists():
        return {"available": False, "inference_provider": s.inference_provider}
    art = json.loads(path.read_text())
    keys = ("version", "created_at", "framework", "architecture", "training_origin", "dataset", "classes", "features", "calibration", "metrics", "limitations")
    return {"available": True, "inference_provider": s.inference_provider, **{k: art[k] for k in keys}}


@router.get("/stations/{code}/protocol", tags=["AI analysis"])
def get_protocol(station: StationDep):
    p = station.protocol
    return {
        "id": p.id, "name": p.name, "version": p.version, "validation_status": p.validation_status, "validation_reference": p.validation_reference,
        "config": merged(p.config), "formulas": FORMULAS, "activity_sources": ACTIVITY_SOURCES, "updated_at": p.updated_at,
    }


@router.put("/protocols/{protocol_id}", tags=["AI analysis"], dependencies=[Depends(admin_user)])
def put_protocol(protocol_id: int, body: ProtocolIn, db: Db):
    p = db.get(Protocol, protocol_id)
    if not p:
        raise HTTPException(404, "Protocol not found.")
    problems = validate(body.config, body.validation_status)
    if body.validation_status == "validated" and not body.validation_reference.strip():
        problems.append("a validated protocol needs a reference to its validation record")
    if problems:
        raise HTTPException(422, "; ".join(problems).capitalize() + ".")
    p.config, p.validation_status, p.validation_reference = merged(body.config), body.validation_status, body.validation_reference.strip()
    p.version = str(int(p.version) + 1) if p.version.isdigit() else p.version + ".1"
    db.commit()
    for s in db.scalars(select(Station).where(Station.protocol_id == p.id)):
        run_assessment(db, s)
        st.invalidate(s.id)
        get_cache().publish({"type": "reading", "station": s.code})
    return {"version": p.version}

