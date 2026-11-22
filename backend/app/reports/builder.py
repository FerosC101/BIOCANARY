"""Historical summary shared by the Reports page, the PDF and the CSV."""

import csv
import io
from collections import Counter
from datetime import datetime

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..analysis.explain import SEVERITY_LABEL
from ..analysis.protocol import FORMULAS, merged
from ..models import Alert, Assessment, Measurement, Sensor, Station
from ..services.data import load_frame
from ..services.patterns import alert_factors
from ..services.series import station_series

BIO_KINDS = ("inhibition", "anomaly", "reference")


def event_severity(a: Alert) -> str:
    return a.severity or {"reference": "inconclusive"}.get(a.kind, "unclassified")


def _events(db: Session, station: Station, start: datetime, end: datetime, severities: list[str]) -> list[dict]:
    rows = db.scalars(
        select(Alert)
        .where(Alert.station_id == station.id, Alert.kind.in_(BIO_KINDS), Alert.started_at <= end, func.coalesce(Alert.ended_at, end) >= start)
        .order_by(Alert.started_at.desc())
    )
    out = []
    for a in rows:
        sev = event_severity(a)
        if severities and sev not in severities:
            continue
        out.append(
            {
                "id": a.id, "kind": a.kind, "severity": sev, "severity_label": SEVERITY_LABEL[sev], "title": a.title, "started_at": a.started_at,
                "ended_at": a.ended_at, "hours": round(((a.ended_at or a.last_seen_at) - a.started_at).total_seconds() / 3600, 1),
                "peak_inhibition": a.peak_inhibition, "factors": alert_factors(db, a), "acknowledged_by": a.acknowledged_by,
            }
        )
    return out


def _stats(s: pd.Series) -> dict:
    v = s.dropna()
    if v.empty:
        return {"min": None, "median": None, "max": None}
    return {"min": round(float(v.min()), 2), "median": round(float(v.median()), 2), "max": round(float(v.max()), 2)}


def build_report(db: Session, station: Station, start: datetime, end: datetime, severities: list[str]) -> dict:
    cfg = merged(station.protocol.config)
    frame = load_frame(db, station, start, end)
    counts = Counter()
    highest = None
    total = 0
    for sev, inh, n in db.execute(
        select(Assessment.severity, func.max(Assessment.inhibition), func.count())
        .where(Assessment.station_id == station.id, Assessment.data_until >= start, Assessment.data_until <= end)
        .group_by(Assessment.severity)
    ):
        counts[sev] = n
        total += n
        if inh is not None and sev not in ("inconclusive", "insufficient"):
            highest = max(inh, highest) if highest is not None else inh
    quality: dict[str, Counter] = {}
    for code, q, n in db.execute(
        select(Sensor.code, Measurement.quality, func.count())
        .join(Sensor, Sensor.id == Measurement.sensor_id)
        .where(Measurement.station_id == station.id, Measurement.recorded_at >= start, Measurement.recorded_at <= end)
        .group_by(Sensor.code, Measurement.quality)
    ):
        quality.setdefault(code, Counter())[q] = n

    minutes = max(10, round(station.expected_interval_seconds / 60))
    binned = frame.resample(f"{minutes}min").median() if minutes > 10 else frame
    expected = max(1, len(binned))
    sensors = []
    for s in station.sensors:
        col = f"{s.location[:3]}_{s.quantity}"
        series = binned[col] if col in binned else pd.Series(dtype=float)
        q = quality.get(s.code, Counter())
        sensors.append(
            {
                "code": s.code, "name": s.name, "unit": s.unit, "location": s.location, **_stats(series),
                "coverage": round(float(series.notna().sum()) / expected, 4), "invalid": q["invalid"], "missing": q["missing"], "suspect": q["suspect"],
            }
        )
    paired = binned[["ref_activity", "exp_activity"]].notna().all(axis=1) if len(binned) else pd.Series(dtype=bool)
    any_data = binned.drop(columns=["ref_activity", "exp_activity"]).notna().any(axis=1) if len(binned) else pd.Series(dtype=bool)
    events = _events(db, station, start, end, severities)
    series = station_series(db, station, start, end)
    ind = [v for v in series["channels"].get("inhibition", []) if v is not None]
    return {
        "station": {"code": station.code, "name": station.name, "facility": station.facility.name, "timezone": station.facility.timezone, "origin": station.origin},
        "period": {"start": start, "end": end}, "severities": severities,
        "protocol": {
            "name": station.protocol.name, "version": station.protocol.version, "validation_status": station.protocol.validation_status,
            "validation_reference": station.protocol.validation_reference, "formula": FORMULAS[cfg["formula"]], "thresholds": cfg["thresholds"],
            "activity_unit": cfg["activity"].get("unit", ""),
        },
        "activity": {"reference": _stats(frame["ref_activity"]) if len(frame) else _stats(pd.Series(dtype=float)), "exposed": _stats(frame["exp_activity"]) if len(frame) else _stats(pd.Series(dtype=float))},
        "inhibition": {"median": round(float(np.median(ind)), 1) if ind else None, "max": round(highest, 1) if highest is not None else None},
        "assessments": {"total": total, "by_severity": [{"severity": k, "label": SEVERITY_LABEL[k], "count": counts[k]} for k in SEVERITY_LABEL if counts[k]]},
        "events": events,
        "event_counts": Counter(e["severity"] for e in events),
        "sensors": sensors,
        "performance": {
            "expected_intervals": expected, "reporting": round(float(any_data.sum()) / expected, 4) if len(any_data) else 0.0,
            "paired": round(float(paired.sum()) / expected, 4) if len(paired) else 0.0,
            "invalid": sum(q["invalid"] for q in quality.values()), "missing": sum(q["missing"] for q in quality.values()),
            "suspect": sum(q["suspect"] for q in quality.values()), "interval_minutes": minutes,
        },
        "series": series,
        "has_data": series["has_data"],
    }


def build_csv(db: Session, station: Station, start: datetime, end: datetime, severities: list[str]) -> bytes:
    """One row per 10-minute interval. With a severity filter, only intervals inside matching events."""
    frame = load_frame(db, station, start, end)
    cfg = merged(station.protocol.config)
    assess = pd.DataFrame(
        db.execute(
            select(Assessment.slot, Assessment.severity, Assessment.inhibition, Assessment.confidence, Assessment.model_version, Assessment.protocol_version)
            .where(Assessment.station_id == station.id, Assessment.slot >= start, Assessment.slot <= end)
        ).all(),
        columns=["slot", "severity", "inhibition", "confidence", "model", "protocol"],
    )
    assess = assess.set_index(pd.to_datetime(assess["slot"], utc=True)).reindex(frame.index)
    sensors = [(f"{s.location[:3]}_{s.quantity}", f"{s.location}_{s.quantity} ({s.unit})") for s in station.sensors]
    keep = pd.Series(True, index=frame.index)
    if severities:
        keep[:] = False
        for e in _events(db, station, start, end, severities):
            keep.loc[pd.Timestamp(e["started_at"]).floor("10min") : pd.Timestamp(e["ended_at"] or end)] = True
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["timestamp_utc", "station", "data_origin", *(h for _, h in sensors), f"inhibition_indicator (% {cfg['formula']})", "assessed_severity", "model_confidence", "protocol", "model"])
    cell = lambda v: "" if v is None or (isinstance(v, float) and not np.isfinite(v)) else v  # noqa: E731
    for ts, row in frame[keep].iterrows():
        a = assess.loc[ts]
        values = [cell(round(float(row[c]), 4)) if c in row and np.isfinite(row[c]) else "" for c, _ in sensors]
        inh = cell(a["inhibition"])
        w.writerow([ts.isoformat(), station.code, station.origin, *values, round(inh, 2) if inh != "" else "", *(("" if pd.isna(a[k]) else a[k]) for k in ("severity", "confidence", "protocol", "model"))])
    return ("﻿" + out.getvalue()).encode()
