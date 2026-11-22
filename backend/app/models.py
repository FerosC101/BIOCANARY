"""Relational schema (SQLite locally, Huawei Cloud RDS for PostgreSQL in production).

`origin` ("simulated" | "live") is fixed on the station and copied to every derived record, so a
simulated value can never be presented as, or aggregated with, a hardware measurement.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

ORIGINS = ("simulated", "live")
LOCATIONS = ("reference", "exposed", "environment")
QUALITIES = ("valid", "suspect", "invalid", "missing")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default="operator")  # operator | admin
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Facility(Base):
    __tablename__ = "facilities"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    location: Mapped[str] = mapped_column(String(160), default="")
    timezone: Mapped[str] = mapped_column(String(60), default="UTC")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    stations: Mapped[list["Station"]] = relationship(back_populates="facility")


class Protocol(Base):
    """Experimental protocol: how activity is obtained and how inhibition is computed and classified."""

    __tablename__ = "protocols"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    version: Mapped[str] = mapped_column(String(20), default="1")
    # unvalidated | demonstration | validated
    validation_status: Mapped[str] = mapped_column(String(20), default="unvalidated")
    validation_reference: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Station(Base):
    __tablename__ = "stations"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    origin: Mapped[str] = mapped_column(String(12))  # simulated | live
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"))
    protocol_id: Mapped[int] = mapped_column(ForeignKey("protocols.id"))
    expected_interval_seconds: Mapped[int] = mapped_column(Integer, default=600)
    sim_profile: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    facility: Mapped[Facility] = relationship(back_populates="stations")
    protocol: Mapped[Protocol] = relationship()
    sensors: Mapped[list["Sensor"]] = relationship(back_populates="station", order_by="Sensor.id")
    devices: Mapped[list["Device"]] = relationship(back_populates="station")


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    key_hash: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    firmware: Mapped[str] = mapped_column(String(40), default="")
    state: Mapped[str] = mapped_column(String(20), default="unknown")  # ok | degraded | fault | unknown
    faults: Mapped[list[str]] = mapped_column(JSON, default=list)
    last_sequence: Mapped[int | None] = mapped_column(Integer)
    last_seen_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    station: Mapped[Station] = relationship(back_populates="devices")


class Sensor(Base):
    __tablename__ = "sensors"
    __table_args__ = (UniqueConstraint("station_id", "code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    code: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(20))  # reference | exposed | environment
    quantity: Mapped[str] = mapped_column(String(40))
    unit: Mapped[str] = mapped_column(String(20))
    valid_min: Mapped[float | None] = mapped_column(Float)
    valid_max: Mapped[float | None] = mapped_column(Float)
    max_step: Mapped[float | None] = mapped_column(Float)  # larger jumps are kept but marked "suspect"
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    station: Mapped[Station] = relationship(back_populates="sensors")


class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        UniqueConstraint("sensor_id", "recorded_at"),
        Index("ix_measurements_station_time", "station_id", "recorded_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id"))
    recorded_at: Mapped[datetime]
    received_at: Mapped[datetime] = mapped_column(default=utcnow)
    value: Mapped[float | None] = mapped_column(Float)
    quality: Mapped[str] = mapped_column(String(10))  # valid | suspect | invalid | missing
    quality_reason: Mapped[str] = mapped_column(String(160), default="")
    origin: Mapped[str] = mapped_column(String(12))


class ProcessEvent(Base):
    """Operator-recorded sampling, discharge or maintenance events."""

    __tablename__ = "process_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    occurred_at: Mapped[datetime]
    kind: Mapped[str] = mapped_column(String(20))  # sampling | discharge | maintenance | other
    note: Mapped[str] = mapped_column(Text, default="")
    origin: Mapped[str] = mapped_column(String(12))
    recorded_by: Mapped[str] = mapped_column(String(160), default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (UniqueConstraint("station_id", "slot"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    slot: Mapped[datetime]  # start of the 10-minute slot; re-analysis inside a slot updates the record
    assessed_at: Mapped[datetime]
    data_until: Mapped[datetime]
    origin: Mapped[str] = mapped_column(String(12))
    severity: Mapped[str] = mapped_column(String(16))
    anomaly: Mapped[bool] = mapped_column(Boolean, default=False)
    inhibition: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    protocol_version: Mapped[str] = mapped_column(String(80), default="")
    model_version: Mapped[str] = mapped_column(String(80), default="")
    inference_backend: Mapped[str] = mapped_column(String(20), default="")
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_station_time", "station_id", "started_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    kind: Mapped[str] = mapped_column(String(24))  # inhibition | anomaly | reference | sensor | offline
    level: Mapped[str] = mapped_column(String(12))  # warning | critical
    severity: Mapped[str] = mapped_column(String(16), default="")  # peak inhibition class, when classified
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(12))
    started_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]
    ended_at: Mapped[datetime | None]
    clear_since: Mapped[datetime | None]
    peak_inhibition: Mapped[float | None] = mapped_column(Float)
    acknowledged_at: Mapped[datetime | None]
    acknowledged_by: Mapped[str | None] = mapped_column(String(160))
    acknowledge_note: Mapped[str] = mapped_column(Text, default="")


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_by: Mapped[str] = mapped_column(String(160))
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    severity_filter: Mapped[str] = mapped_column(String(60), default="")
    format: Mapped[str] = mapped_column(String(8))
    origin: Mapped[str] = mapped_column(String(12))
    filename: Mapped[str] = mapped_column(String(200))
    object_key: Mapped[str] = mapped_column(String(300))
    object_provider: Mapped[str] = mapped_column(String(20))
    size_bytes: Mapped[int] = mapped_column(Integer)


class ArchiveObject(Base):
    """Daily raw-measurement files written to object storage (Huawei Cloud OBS)."""

    __tablename__ = "archive_objects"
    __table_args__ = (UniqueConstraint("station_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"))
    day: Mapped[str] = mapped_column(String(10))
    object_key: Mapped[str] = mapped_column(String(300))
    object_provider: Mapped[str] = mapped_column(String(20))
    rows: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
