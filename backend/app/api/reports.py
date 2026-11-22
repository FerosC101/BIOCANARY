from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select

from ..cloud.registry import get_objects
from ..db import utcnow
from ..models import Report, Station
from ..reports.builder import build_csv, build_report
from ..reports.pdf import build_pdf
from ..schemas import ReportIn
from .deps import CurrentUser, Db, PeriodDep, StationDep, aware, check_period

router = APIRouter(tags=["Reports"])
MEDIA = {"pdf": "application/pdf", "csv": "text/csv; charset=utf-8"}
ALLOWED = {"mild", "moderate", "severe", "unclassified", "inconclusive"}


def report_out(r: Report, station: Station) -> dict:
    return {
        "id": r.id, "created_at": r.created_at, "created_by": r.created_by, "station": station.code, "station_name": station.name,
        "period_start": r.period_start, "period_end": r.period_end, "format": r.format, "origin": r.origin, "filename": r.filename,
        "size_bytes": r.size_bytes, "severity_filter": r.severity_filter, "object_provider": r.object_provider,
    }


@router.get("/stations/{code}/report")
def report(station: StationDep, db: Db, period: PeriodDep, severity: str = Query("")):
    chosen = [s for s in severity.split(",") if s in ALLOWED]
    return build_report(db, station, period.start, period.end, chosen)


@router.get("/reports")
def list_reports(db: Db, _: CurrentUser):
    rows = db.execute(select(Report, Station).join(Station, Station.id == Report.station_id).order_by(Report.created_at.desc()).limit(50))
    return [report_out(r, s) for r, s in rows]


@router.post("/reports", status_code=201)
def create_report(body: ReportIn, db: Db, user: CurrentUser):
    station = db.scalar(select(Station).where(Station.code == body.station))
    if not station:
        raise HTTPException(404, "Station not found.")
    start, end = aware(body.start), aware(body.end)
    check_period(start, end)
    now: datetime = utcnow()
    if body.format == "pdf":
        data = build_pdf(build_report(db, station, start, end, body.severities), user.name, now)
    else:
        data = build_csv(db, station, start, end, body.severities)
    tag = "_SIMULATED" if station.origin == "simulated" else ""
    filename = f"BIOCANARY_{station.code}_{start:%Y%m%d}-{end:%Y%m%d}{tag}.{body.format}"
    key = f"reports/{station.origin}/{station.code}/{now:%Y/%m}/{uuid4().hex}.{body.format}"
    try:
        get_objects().put(key, data, MEDIA[body.format])
    except Exception as exc:
        raise HTTPException(502, "The report was generated but object storage did not accept it. Nothing was saved.") from exc
    r = Report(
        created_at=now, created_by=user.name, station_id=station.id, period_start=start, period_end=end, severity_filter=",".join(body.severities),
        format=body.format, origin=station.origin, filename=filename, object_key=key, object_provider=get_objects().provider, size_bytes=len(data),
    )
    db.add(r)
    db.commit()
    return report_out(r, station)


@router.get("/reports/{report_id}/download")
def download(report_id: int, db: Db, _: CurrentUser):
    r = db.get(Report, report_id)
    if not r:
        raise HTTPException(404, "Report not found.")
    try:
        data = get_objects().get(r.object_key)
    except Exception as exc:
        raise HTTPException(502, "The report file could not be read from object storage.") from exc
    return Response(data, media_type=MEDIA[r.format], headers={"Content-Disposition": f'attachment; filename="{r.filename}"', "Cache-Control": "no-store"})
