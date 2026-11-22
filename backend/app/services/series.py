from datetime import timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from ..analysis.protocol import merged
from ..analysis.signals import inhibition_indicator, window_bins
from ..models import Station
from .data import load_frame

MAX_POINTS = 360


def station_series(db: Session, station: Station, start, end) -> dict:
    cfg = merged(station.protocol.config)
    lead = timedelta(minutes=cfg["assessment_window_minutes"] + 60)
    if cfg["formula"] == "baseline_normalised":
        lead += timedelta(days=cfg["baseline"]["days"])
    frame = load_frame(db, station, start - lead, end)
    n = window_bins(cfg)
    need = max(1, int(np.ceil(cfg["min_valid_fraction"] * n)))
    ref = frame["ref_activity"].rolling(n, min_periods=need).median()
    exp = frame["exp_activity"].rolling(n, min_periods=need).median()
    base = frame.loc[: pd.Timestamp(start)] if cfg["formula"] == "baseline_normalised" else None
    frame["inhibition"] = inhibition_indicator(ref, exp, cfg, base)
    frame = frame.loc[pd.Timestamp(start) :]
    step = max(1, int(np.ceil(len(frame) / MAX_POINTS)))
    minutes = 10 * step
    if step > 1:
        frame = frame.resample(f"{minutes}min").median()
    frame = frame.dropna(how="all") if frame.notna().any(axis=1).sum() == 0 else frame
    clean = lambda s: [None if not np.isfinite(v) else round(float(v), 3) for v in s.to_numpy(dtype=float)]  # noqa: E731
    return {
        "bucket_minutes": minutes,
        "t": [int(x.timestamp() * 1000) for x in frame.index],
        "channels": {c: clean(frame[c]) for c in frame.columns},
        "activity_unit": cfg["activity"].get("unit", ""),
        "thresholds": cfg["thresholds"],
        "has_data": bool(frame.notna().any().any()) if len(frame) else False,
    }
