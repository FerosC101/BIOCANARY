"""Validation and storage of device readings."""

import math
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import utcnow
from ..models import Device, Measurement, Sensor, Station
from ..schemas import DeviceStatusIn, MeasurementIn, MeasurementResult, ReadingIn, ReadingResult

_FAULT_STATUS = {"fault": ("invalid", "sensor reported a fault"), "calibrating": ("invalid", "sensor is calibrating")}


def judge(m: MeasurementIn, sensor: Sensor, previous: tuple[datetime, float] | None, at: datetime, interval: int) -> tuple[float | None, str, str]:
    """Returns (stored value, quality, reason)."""
    value = m.value
    if m.status == "missing" or value is None or not math.isfinite(value):
        return None, "missing", "no value reported"
    if m.status in _FAULT_STATUS:
        return value, *_FAULT_STATUS[m.status]
    if sensor.valid_min is not None and value < sensor.valid_min:
        return value, "invalid", f"below the valid range ({sensor.valid_min:g} {sensor.unit})"
    if sensor.valid_max is not None and value > sensor.valid_max:
        return value, "invalid", f"above the valid range ({sensor.valid_max:g} {sensor.unit})"
    if previous and sensor.max_step and timedelta(0) < at - previous[0] <= timedelta(seconds=max(interval * 2, 120)):
        if abs(value - previous[1]) > sensor.max_step:
            return value, "suspect", f"changed by more than {sensor.max_step:g} {sensor.unit} in one reading"
    return value, "valid", ""


class Ingestor:
    """Processes one or more readings from an authenticated device inside a single transaction."""

    def __init__(self, db: Session, device: Device) -> None:
        self.db, self.device, self.station = db, device, device.station
        self.sensors = {s.code: s for s in self.station.sensors if s.active}
        self._previous: dict[int, tuple[datetime, float] | None] = {}

    def _last(self, sensor: Sensor, before: datetime) -> tuple[datetime, float] | None:
        cached = self._previous.get(sensor.id)
        if cached and cached[0] < before:
            return cached
        row = self.db.execute(
            select(Measurement.recorded_at, Measurement.value)
            .where(
                Measurement.sensor_id == sensor.id,
                Measurement.recorded_at < before,
                # A suspect value counts as "previous", so a real step change is accepted once it persists.
                Measurement.quality.in_(("valid", "suspect")),
            )
            .order_by(Measurement.recorded_at.desc())
            .limit(1)
        ).first()
        return (row[0], row[1]) if row else None

    def reading(self, r: ReadingIn) -> ReadingResult:
        s = get_settings()
        now = utcnow()
        reject = lambda why: ReadingResult(recorded_at=r.recorded_at, accepted=False, stored=0, reason=why)  # noqa: E731
        if r.station_id != self.station.code:
            return reject("this device is not assigned to that station")
        if r.recorded_at.tzinfo is None:
            return reject("recorded_at must include a timezone")
        if r.recorded_at > now + timedelta(seconds=s.max_future_skew_seconds):
            return reject("recorded_at is in the future; check the device clock")
        if r.recorded_at < now - timedelta(days=s.max_backfill_days):
            return reject(f"recorded_at is older than {s.max_backfill_days} days")

        if r.device_status:
            self.status(r.device_status)
        existing = set(
            self.db.scalars(
                select(Measurement.sensor_id).where(
                    Measurement.station_id == self.station.id, Measurement.recorded_at == r.recorded_at
                )
            )
        )
        results, seen = [], set()
        add = lambda code, result, quality=None, why="": results.append(  # noqa: E731
            MeasurementResult(sensor_id=code, result=result, quality=quality, reason=why)
        )
        for m in r.measurements:
            sensor = self.sensors.get(m.sensor_id)
            if sensor is None:
                add(m.sensor_id, "rejected", why="sensor is not registered at this station")
                continue
            if m.sensor_id in seen:
                add(m.sensor_id, "rejected", why="sensor appears more than once in this reading")
                continue
            seen.add(m.sensor_id)
            if m.unit is not None and m.unit != sensor.unit:
                add(m.sensor_id, "rejected", why=f"unit must be {sensor.unit}")
                continue
            if m.location is not None and m.location != sensor.location:
                add(m.sensor_id, "rejected", why=f"sensor is registered in location {sensor.location}")
                continue
            if sensor.id in existing:
                add(m.sensor_id, "duplicate", why="already stored for this timestamp")
                continue
            value, quality, why = judge(
                m, sensor, self._last(sensor, r.recorded_at), r.recorded_at, self.station.expected_interval_seconds
            )
            self._store(sensor, r.recorded_at, now, value, quality, why)
            add(m.sensor_id, "stored", quality, why)
        if not r.partial:
            for code, sensor in self.sensors.items():
                if code not in seen and sensor.id not in existing:
                    self._store(sensor, r.recorded_at, now, None, "missing", "not included in the device payload")
                    add(code, "stored", "missing", "not included in the device payload")

        stored = sum(x.result == "stored" for x in results)
        if stored or any(x.result == "duplicate" for x in results):
            self.device.last_seen_at = now
            if r.sequence is not None:
                self.device.last_sequence = r.sequence
        return ReadingResult(recorded_at=r.recorded_at, accepted=any(x.result != "rejected" for x in results), stored=stored, measurements=results)

    def status(self, st: DeviceStatusIn) -> None:
        self.device.state, self.device.faults = st.state, list(st.faults)
        self.device.firmware = st.firmware or self.device.firmware
        self.device.last_seen_at = utcnow()

    def _store(self, sensor, at, received, value, quality, why) -> None:
        self.db.add(
            Measurement(
                station_id=self.station.id,
                sensor_id=sensor.id,
                recorded_at=at,
                received_at=received,
                value=value,
                quality=quality,
                quality_reason=why,
                origin=self.station.origin,
            )
        )
        if value is not None and quality in ("valid", "suspect"):
            prev = self._previous.get(sensor.id)
            if prev is None or prev[0] < at:
                self._previous[sensor.id] = (at, value)


def last_reading_at(db: Session, station: Station) -> datetime | None:
    return db.scalar(
        select(Measurement.recorded_at)
        .where(Measurement.station_id == station.id, Measurement.quality != "missing")
        .order_by(Measurement.recorded_at.desc())
        .limit(1)
    )
