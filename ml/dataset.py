"""Builds the labelled feature dataset for the inhibition classifier.

    python ml/dataset.py --out ml/data/simulated.csv

The only source implemented today is the simulator, because no experimental dataset exists yet.
Labels come from the simulator's latent inhibition, not from the measured indicator, so the classifier
has to see through sensor noise rather than reproduce the threshold rule.

An experimental dataset must use the same columns with origin=experimental and labels from a reference
method. See docs/ml.md.
"""

import argparse
import sys
import warnings
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.analysis.features import FEATURES, extract_features  # noqa: E402
from app.analysis.frame import add_activity  # noqa: E402
from app.analysis.protocol import DEFAULT_CONFIG, merged  # noqa: E402
from app.simulation.engine import SENSORS, generate, grid_times  # noqa: E402

THRESHOLDS = {"mild": 10.0, "moderate": 25.0, "severe": 50.0}  # demonstration boundaries
CLASSES = ["normal", "mild", "moderate", "severe"]


def simulated_frame(profile: dict, start: datetime, end: datetime) -> tuple[pd.DataFrame, pd.Series]:
    times = grid_times(start, end, 600)
    values, latent = generate(profile, times)
    index = pd.DatetimeIndex(times)
    cols = {}
    for code, _, location, quantity, _, lo, hi, _ in SENSORS:
        v = values[code]
        cols[f"{location[:3]}_{quantity}"] = np.where((v < lo) | (v > hi), np.nan, v)
    return add_activity(pd.DataFrame(cols, index=index), merged(DEFAULT_CONFIG)), pd.Series(latent, index=index)


def label_of(latent: float) -> str:
    return CLASSES[sum(latent >= THRESHOLDS[c] for c in ("mild", "moderate", "severe"))]


def build(stations: int, per_station: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    cfg, rows = merged(DEFAULT_CONFIG), []
    for i in range(stations):
        profile = {
            "seed": int(rng.integers(10_000, 10_000_000)),
            "level": float(rng.uniform(25, 60)),
            "chamber_offset": float(rng.uniform(0.95, 1.04)),
            "event_rate": 0.6,
            "peak_range": [3, 75],
            "noise": float(rng.uniform(1.0, 3.0)),
        }
        start = datetime(2025, 1, 1, tzinfo=UTC) + timedelta(days=int(rng.integers(0, 300)))
        frame, latent = simulated_frame(profile, start, start + timedelta(days=14))
        window = latent.rolling(6).median()
        usable = window.iloc[144 * 8 :]
        classes = usable.map(label_of)
        for c in CLASSES:  # balance within a station as far as its events allow
            pool = usable.index[classes == c]
            for at in rng.choice(pool.to_numpy(), min(len(pool), per_station // 4), replace=False):
                at = pd.Timestamp(at, tz="UTC") if pd.Timestamp(at).tzinfo is None else pd.Timestamp(at)
                f = extract_features(frame, at, cfg)
                if f is not None:
                    rows.append({"group": i, "origin": "simulated", "at": at.isoformat(), "latent": round(float(window[at]), 3), "label": c, **f})
    return pd.DataFrame(rows)[["group", "origin", "at", "latent", "label", *FEATURES]]


if __name__ == "__main__":
    warnings.filterwarnings("ignore", "Mean of empty slice")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ml/data/simulated.csv")
    ap.add_argument("--stations", type=int, default=150)
    ap.add_argument("--per-station", type=int, default=64)
    ap.add_argument("--seed", type=int, default=20)
    a = ap.parse_args()
    df = build(a.stations, a.per_station, a.seed)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(a.out, index=False)
    print(f"{len(df)} rows from {df.group.nunique()} simulated stations -> {a.out}")
    print(df.label.value_counts().to_string())
