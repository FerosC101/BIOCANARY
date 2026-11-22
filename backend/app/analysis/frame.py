"""Turns stored measurements into the regular 10-minute grid every analysis works on."""

from datetime import datetime

import numpy as np
import pandas as pd

GRID = "10min"
GRID_MINUTES = 10
ENV_FACTORS = ("ph", "temperature", "conductivity", "dissolved_oxygen", "flow")


def build_frame(rows: list[tuple], config: dict, start: datetime, end: datetime) -> pd.DataFrame:
    """rows: (recorded_at, location, quantity, value) for measurements with quality "valid" only."""
    index = pd.date_range(
        pd.Timestamp(start).floor(GRID), pd.Timestamp(end).floor(GRID), freq=GRID, tz=None if pd.Timestamp(start).tzinfo else "UTC"
    )
    if rows:
        df = pd.DataFrame(rows, columns=["ts", "location", "quantity", "value"])
        df["col"] = df["location"].str.slice(0, 3) + "_" + df["quantity"]
        df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.floor(GRID)
        frame = df.pivot_table(index="ts", columns="col", values="value", aggfunc="median").reindex(index)
    else:
        frame = pd.DataFrame(index=index)
    return add_activity(frame, config)


def add_activity(frame: pd.DataFrame, config: dict) -> pd.DataFrame:
    act = config["activity"]
    frame = frame.copy()
    for prefix in ("ref", "exp"):
        if act["source"] == "direct":
            series = frame.get(f"{prefix}_{act['quantity']}")
        else:
            do = frame.get(f"{prefix}_dissolved_oxygen")
            series = None if do is None else uptake_rate(do, act.get("window_minutes", 30))
        frame[f"{prefix}_activity"] = np.nan if series is None else series
    return frame


def uptake_rate(do: pd.Series, window_minutes: int) -> pd.Series:
    """Dissolved-oxygen decline in mg/L per hour (positive = consumption), least squares per window."""
    n = max(2, round(window_minutes / GRID_MINUTES) + 1)
    x = np.arange(n) * GRID_MINUTES / 60
    xc = x - x.mean()
    return do.rolling(n, min_periods=n).apply(lambda y: -float(xc @ (y - y.mean()) / (xc @ xc)), raw=True)


def env_column(quantity: str) -> str:
    return f"env_{quantity}"
