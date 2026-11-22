"""Supporting measurements that moved alongside an abnormal biological response.

The output describes association in time. One event contains very little independent information
(the series are strongly autocorrelated), so significance is judged on the effective sample size and
nothing here is ever presented as a cause.
"""

import numpy as np
import pandas as pd
from scipy import stats

from .frame import ENV_FACTORS, GRID_MINUTES, env_column
from .signals import Signals, baseline_slice, robust_center_scale

LABELS = {
    "ph": "pH",
    "temperature": "Wastewater temperature",
    "conductivity": "Conductivity",
    "dissolved_oxygen": "Wastewater dissolved oxygen",
    "flow": "Wastewater flow",
}
# Smallest spread treated as meaningful, so a very quiet sensor does not report huge deviations.
FLOORS = {"ph": 0.05, "temperature": 0.2, "conductivity": 15.0, "dissolved_oxygen": 0.1, "flow": 1.5}
DEVIATION_Z = 3.5
MAX_LAG_BINS = 18


def response_onset(sig: Signals) -> pd.Timestamp | None:
    """Start of the current run of abnormal response (walking back until it is ordinary again)."""
    if sig.z_series is None:
        return None
    z = sig.z_series.dropna()
    onset, quiet = None, 0
    for ts, v in z.iloc[::-1].items():
        if abs(v) >= 2:
            onset, quiet = ts, 0
        else:
            quiet += 1
            if onset is None and quiet > 6 or onset is not None and quiet >= 3:
                break
    if onset is None or sig.fast_z_series is None:
        return onset
    # The assessment median lags a step by up to half its window: walk back over contiguous abnormal readings.
    sign = np.sign(z.loc[onset])
    for ts in reversed(sig.fast_z_series.loc[onset - pd.Timedelta(minutes=90) : onset].index):
        v = sig.fast_z_series.loc[ts] * sign
        if np.isfinite(v) and v < 2.5:
            break
        if np.isfinite(v):
            onset = ts
    return onset


def effective_n(x: np.ndarray, y: np.ndarray) -> float:
    r = np.corrcoef(x[:-1], x[1:])[0, 1] * np.corrcoef(y[:-1], y[1:])[0, 1]
    r = float(np.clip(np.nan_to_num(r), 0, 0.999))
    return max(3.0, len(x) * (1 - r) / (1 + r))


def contributing_factors(frame: pd.DataFrame, at: pd.Timestamp, sig: Signals, config: dict) -> list[dict]:
    onset = response_onset(sig)
    if onset is None or sig.indicator_series is None:
        return []
    frame = frame.loc[:at]
    base = baseline_slice(frame, at, config)
    start = min(onset - pd.Timedelta(hours=6), at - pd.Timedelta(hours=12))
    response = sig.indicator_series.loc[start:at]
    out = []
    for q in ENV_FACTORS:
        col = env_column(q)
        if col not in frame or base[col].dropna().shape[0] < 36:
            continue
        smooth = frame[col].rolling(3, min_periods=1).median()
        med, sd = robust_center_scale(base[col].dropna().to_numpy(), FLOORS[q])
        z = (smooth - med) / sd
        around = z.loc[onset - pd.Timedelta(minutes=MAX_LAG_BINS * GRID_MINUTES) : at].dropna()
        if around.empty:
            continue
        peak_at = around.abs().idxmax()
        crossings = around.index[around.abs() >= DEVIATION_Z]
        deviated = len(crossings) > 1
        best = None
        for lag in range(0, MAX_LAG_BINS + 1, 2):
            pair = pd.concat([smooth.shift(lag).loc[start:at], response], axis=1).dropna().to_numpy()
            if len(pair) < 24 or np.ptp(pair[:, 0]) == 0:
                continue
            rho = float(stats.spearmanr(pair[:, 0], pair[:, 1]).statistic)
            if np.isfinite(rho) and (best is None or abs(rho) > abs(best["rho"])):
                best = {"rho": rho, "lag": lag * GRID_MINUTES, "n": len(pair), "n_eff": effective_n(pair[:, 0], pair[:, 1])}
        rho = best["rho"] if best else None
        strength = "none"
        if deviated and rho is not None and abs(rho) >= 0.6:
            strength = "strong"
        elif deviated:
            strength = "moderate"
        lead = float((onset - crossings[0]).total_seconds() / 60) if deviated else None
        out.append(
            {
                "quantity": q,
                "label": LABELS[q],
                "strength": strength,
                "baseline": round(med, 3),
                "peak": round(float(smooth.loc[peak_at]), 3),
                "deviation_z": round(float(around.loc[peak_at]), 2),
                "lead_minutes": lead,
                "rho": round(rho, 3) if rho is not None else None,
                "lag_minutes": best["lag"] if best else None,
                "effective_n": round(best["n_eff"], 1) if best else None,
            }
        )
    order = {"strong": 0, "moderate": 1, "none": 2}
    return sorted(out, key=lambda f: (order[f["strength"]], -abs(f["deviation_z"])))
