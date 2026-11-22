"""Historical patterns, computed from stored assessments and alerts."""

from collections import Counter
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Alert, Assessment, Station

BIO = ("inhibition", "anomaly")


def alert_factors(db: Session, alert: Alert) -> list[str]:
    a = db.scalar(
        select(Assessment)
        .where(
            Assessment.station_id == alert.station_id,
            Assessment.data_until >= alert.started_at,
            Assessment.data_until <= (alert.ended_at or alert.last_seen_at),
        )
        .order_by(Assessment.inhibition.desc())
        .limit(1)
    )
    return [f["label"] for f in (a.detail["factors"] if a else []) if f["strength"] != "none"]


def patterns(db: Session, station: Station, end, days: int = 30, current: Alert | None = None) -> dict:
    tz = ZoneInfo(station.facility.timezone)
    start = end - timedelta(days=days)
    alerts = db.scalars(
        select(Alert).where(Alert.station_id == station.id, Alert.kind.in_(BIO), Alert.started_at >= start, Alert.started_at <= end).order_by(Alert.started_at.desc())
    ).all()
    daily: dict[str, dict] = {}
    for at, sev, inh in db.execute(
        select(Assessment.data_until, Assessment.severity, Assessment.inhibition).where(
            Assessment.station_id == station.id, Assessment.data_until >= start, Assessment.data_until <= end
        )
    ):
        d = daily.setdefault(at.astimezone(tz).date().isoformat(), {"max_inhibition": None, "severity": "normal", "withheld": 0, "count": 0})
        d["count"] += 1
        rank = ("normal", "mild", "moderate", "severe")
        if sev in rank:
            if rank.index(sev) > rank.index(d["severity"]):
                d["severity"] = sev
            if inh is not None:
                d["max_inhibition"] = round(max(inh, d["max_inhibition"] if d["max_inhibition"] is not None else inh), 1)
        else:
            d["withheld"] += 1
    episodes = []
    for a in alerts:
        episodes.append(
            {
                "id": a.id, "started_at": a.started_at.isoformat(), "ended_at": a.ended_at.isoformat() if a.ended_at else None,
                "hours": round(((a.ended_at or a.last_seen_at) - a.started_at).total_seconds() / 3600, 1),
                "severity": a.severity or "unclassified", "peak_inhibition": a.peak_inhibition, "factors": alert_factors(db, a),
            }
        )
    past = [e for e in episodes if not current or e["id"] != current.id]
    factor_counts = Counter(f for e in past for f in e["factors"])
    similar = []
    if current is not None:
        mine = set(alert_factors(db, current))
        for e in past:
            if e["peak_inhibition"] is None or current.peak_inhibition is None:
                continue
            union = mine | set(e["factors"])
            overlap = len(mine & set(e["factors"])) / len(union) if union else 1.0
            distance = abs(e["peak_inhibition"] - current.peak_inhibition) / 50 + (1 - overlap)
            similar.append({**e, "distance": round(distance, 2)})
        similar = sorted((s for s in similar if s["distance"] < 1.0), key=lambda s: s["distance"])[:3]
    durations = sorted(e["hours"] for e in past if e["ended_at"])
    return {
        "days": days, "from": start.isoformat(), "to": end.isoformat(),
        "daily": [{"date": k, **v} for k, v in sorted(daily.items())],
        "episodes": episodes[:12], "episode_count": len(episodes), "past_count": len(past),
        "median_hours": durations[len(durations) // 2] if durations else None,
        "by_hour": [sum(1 for a in alerts if a.started_at.astimezone(tz).hour // 3 == b) for b in range(8)],
        "factors": [{"label": k, "count": v} for k, v in factor_counts.most_common()],
        "similar": similar, "timezone": station.facility.timezone,
    }
