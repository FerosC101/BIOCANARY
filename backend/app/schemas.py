from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class LoginIn(BaseModel):
    email: str = Field(max_length=160)
    password: str = Field(max_length=200)


class MeasurementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sensor_id: Code = Field(examples=["EXP-DO"])
    value: float | None = Field(default=None, description="null when the sensor produced no reading", examples=[5.82], allow_inf_nan=True)
    unit: str | None = Field(default=None, max_length=20, description="Checked against the registered unit when given", examples=["mg/L"])
    location: Literal["reference", "exposed", "environment"] | None = Field(default=None, description="Checked against the registered location when given")
    status: Literal["ok", "fault", "missing", "calibrating"] = "ok"


class DeviceStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["ok", "degraded", "fault"] = "ok"
    firmware: str = Field(default="", max_length=40)
    faults: list[Annotated[str, StringConstraints(max_length=120)]] = Field(default_factory=list, max_length=20)


class ReadingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    station_id: Code = Field(examples=["BC-L01"])
    recorded_at: datetime = Field(description="ISO 8601 with timezone, device clock synchronised to UTC")
    sequence: int | None = Field(default=None, ge=0)
    partial: bool = Field(default=False, description="true when registered sensors are intentionally left out of this payload")
    device_status: DeviceStatusIn | None = None
    measurements: list[MeasurementIn] = Field(min_length=1, max_length=64)


class BatchIn(BaseModel):
    readings: list[ReadingIn] = Field(min_length=1)


class StatusIn(BaseModel):
    station_id: Code
    device_status: DeviceStatusIn


class MeasurementResult(BaseModel):
    sensor_id: str
    result: Literal["stored", "duplicate", "rejected"]
    quality: str | None = None
    reason: str = ""


class ReadingResult(BaseModel):
    recorded_at: datetime
    accepted: bool
    stored: int
    reason: str = ""
    measurements: list[MeasurementResult] = []


class EventIn(BaseModel):
    occurred_at: datetime
    kind: Literal["sampling", "discharge", "maintenance", "other"]
    note: str = Field(default="", max_length=500)


class AckIn(BaseModel):
    note: str = Field(default="", max_length=500)


class ReportIn(BaseModel):
    station: Code
    start: datetime
    end: datetime
    severities: list[Literal["mild", "moderate", "severe", "unclassified", "inconclusive"]] = []
    format: Literal["pdf", "csv"]
    # PDF sections; "raw" switches the CSV from 10-minute rows to every individual reading.
    include: list[Literal["verdicts", "charts", "events", "quality", "raw"]] = ["verdicts", "charts", "events", "quality"]


class ProtocolIn(BaseModel):
    validation_status: Literal["unvalidated", "demonstration", "validated"]
    validation_reference: str = Field(default="", max_length=2000)
    config: dict[str, Any]
