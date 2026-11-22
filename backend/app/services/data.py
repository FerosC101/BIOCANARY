from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.frame import build_frame
from ..analysis.protocol import merged
from ..models import Measurement, Sensor, Station


def load_frame(db: Session, station: Station, start: datetime, end: datetime) -> pd.DataFrame:
    rows = db.execute(
        select(Measurement.recorded_at, Sensor.location, Sensor.quantity, Measurement.value)
        .join(Sensor, Sensor.id == Measurement.sensor_id)
        .where(
            Measurement.station_id == station.id,
            Measurement.recorded_at >= start,
            Measurement.recorded_at <= end,
            Measurement.quality == "valid",
        )
    ).all()
    return build_frame([tuple(r) for r in rows], merged(station.protocol.config), start, end)


def analysis_start(station: Station, at: datetime) -> datetime:
    b = merged(station.protocol.config)["baseline"]
    return at - timedelta(days=b["days"], hours=b["guard_hours"] + 3)
