import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ..cloud.registry import cloud_status, get_cache
from ..config import get_settings
from ..models import Measurement, Station
from .deps import CurrentUser, Db

router = APIRouter(tags=["System"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/system/public")
def public():
    """Shown before sign-in. Demo credentials are only disclosed by a local demonstration instance."""
    s = get_settings()
    if s.demo_enabled and s.environment == "local":
        return {"demo": {"email": s.demo_user, "password": s.demo_password}}
    return {"demo": None}


@router.get("/system/status")
def status(db: Db, _: CurrentUser):
    origins = dict(db.execute(select(Station.origin, func.count()).group_by(Station.origin)).all())
    live = db.scalar(select(Measurement.id).where(Measurement.origin == "live").limit(1)) is not None
    return {
        "environment": get_settings().environment,
        "cloud": cloud_status(),
        "data": {"simulated_stations": origins.get("simulated", 0), "live_stations": origins.get("live", 0), "live_data_received": live},
    }


@router.get("/stream")
async def stream(request: Request, _: CurrentUser):
    """Server-sent events: one message whenever a station has new data or an alert changes."""

    async def events():
        yield "retry: 3000\n\n"
        async for event in get_cache().subscribe():
            if await request.is_disconnected():
                break
            # A visible heartbeat: proxies can hold a dead stream open, so the client watches for silence.
            yield f"data: {json.dumps(event or {'type': 'ping'})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
