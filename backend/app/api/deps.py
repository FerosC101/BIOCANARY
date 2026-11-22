from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db, utcnow
from ..models import Device, Station, User
from ..security import SESSION_COOKIE, device_key_matches, read_session_token

Db = Annotated[Session, Depends(get_db)]


def current_user(db: Db, token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None) -> User:
    uid = read_session_token(token) if token else None
    user = db.get(User, uid) if uid else None
    if not user or not user.active:
        raise HTTPException(401, "Sign in to continue.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def admin_user(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only an administrator can change this.")
    return user


def current_device(
    db: Db,
    x_device_id: Annotated[str, Header(description="Device identifier issued at provisioning")],
    x_device_key: Annotated[str, Header(description="Device key issued once at provisioning")],
) -> Device:
    device = db.scalar(select(Device).where(Device.code == x_device_id))
    if not device or not device.active or not device_key_matches(x_device_key, device.key_hash):
        raise HTTPException(401, "Unknown device or invalid key.")
    return device


CurrentDevice = Annotated[Device, Depends(current_device)]


def get_station(code: str, db: Db, _: CurrentUser) -> Station:
    station = db.scalar(select(Station).where(Station.code == code))
    if not station:
        raise HTTPException(404, "Station not found.")
    return station


StationDep = Annotated[Station, Depends(get_station)]


class Period:
    def __init__(self, start: Annotated[datetime | None, Query()] = None, end: Annotated[datetime | None, Query()] = None) -> None:
        self.end = aware(end) if end else utcnow()
        self.start = aware(start) if start else self.end - timedelta(hours=24)
        check_period(self.start, self.end)


def aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def check_period(start: datetime, end: datetime, max_days: int = 366) -> None:
    if start >= end:
        raise HTTPException(422, "The start of the period must be before its end.")
    if end - start > timedelta(days=max_days):
        raise HTTPException(422, f"Choose a period of at most {max_days} days.")


PeriodDep = Annotated[Period, Depends(Period)]
