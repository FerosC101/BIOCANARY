"""Classifier features. Training and inference both call this function, so they cannot diverge."""

import numpy as np
import pandas as pd

from .signals import baseline_slice, window_bins

FEATURES = ("log_ratio", "delta_1h", "delta_3h", "ratio_sd", "do_gap", "ref_shift", "temp_gap")


def extract_features(frame: pd.DataFrame, at: pd.Timestamp, config: dict) -> dict[str, float] | None:
    n = window_bins(config)
    frame = frame.loc[:at]
    base = baseline_slice(frame, at, config)
    lr = np.log(frame["exp_activity"].where(frame["exp_activity"] > 0) / frame["ref_activity"].where(frame["ref_activity"] > 0))
    roll = lr.rolling(n, min_periods=max(1, n // 2)).median()
    base_lr = lr.reindex(base.index).dropna()
    if len(roll) < 19 or len(base_lr) < 36 or not np.isfinite(roll.iloc[-1]):
        return None

    def gap(a: str, b: str) -> float:
        if a not in frame or b not in frame:
            return 0.0
        d = frame[a] - frame[b]
        now, ref = d.iloc[-n:].median(), d.reindex(base.index).median()
        return float(now - ref) if np.isfinite(now) and np.isfinite(ref) else 0.0

    ref_now, ref_base = frame["ref_activity"].iloc[-n:].median(), frame["ref_activity"].reindex(base.index).median()
    past = lambda k: roll.iloc[-1 - k] if np.isfinite(roll.iloc[-1 - k]) else roll.iloc[-1]  # noqa: E731
    sd = lr.iloc[-18:].std()
    return {
        "log_ratio": float(roll.iloc[-1] - base_lr.median()),
        "delta_1h": float(roll.iloc[-1] - past(6)),
        "delta_3h": float(roll.iloc[-1] - past(18)),
        "ratio_sd": float(sd) if np.isfinite(sd) else 0.0,
        "do_gap": gap("exp_dissolved_oxygen", "ref_dissolved_oxygen"),
        "ref_shift": float(np.log(ref_now / ref_base)) if ref_now > 0 and ref_base > 0 else 0.0,
        "temp_gap": gap("exp_temperature", "ref_temperature"),
    }
