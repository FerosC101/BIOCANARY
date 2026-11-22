"""Inhibition indicator, baselines and statistical anomaly detection."""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .frame import GRID_MINUTES


def robust_center_scale(x: np.ndarray, floor: float) -> tuple[float, float]:
    med = float(np.median(x))
    return med, max(float(1.4826 * np.median(np.abs(x - med))), floor)


@dataclass
class Signals:
    sufficient: bool
    reason: str = ""
    valid_fraction: float = 0.0
    ref_activity: float | None = None
    exp_activity: float | None = None
    inhibition: float | None = None
    # versus this station's own history
    baseline_ready: bool = False
    baseline_hours: float = 0.0
    baseline_ratio: float | None = None
    z_response: float | None = None
    z_reference: float | None = None
    reference_shift_pct: float | None = None
    cusum: float | None = None
    anomaly: bool = False
    anomaly_reasons: list[str] = field(default_factory=list)
    reference_suspect: bool = False
    # working series, used by later stages and not persisted
    indicator_series: pd.Series | None = None
    z_series: pd.Series | None = None
    fast_z_series: pd.Series | None = None


def window_bins(config: dict) -> int:
    return max(1, round(config["assessment_window_minutes"] / GRID_MINUTES))


def baseline_slice(frame: pd.DataFrame, at: pd.Timestamp, config: dict) -> pd.DataFrame:
    b = config["baseline"]
    end = at - pd.Timedelta(hours=b["guard_hours"])
    return frame.loc[end - pd.Timedelta(days=b["days"]) : end]


def inhibition_indicator(
    ref: pd.Series, exp: pd.Series, config: dict, baseline: pd.DataFrame | None = None
) -> pd.Series:
    """The protocol's configured formula. Negative values (stimulation) are reported, not clipped."""
    ref = ref.where(ref > (config["min_reference_activity"] or 0))
    if config["formula"] == "baseline_normalised":
        if baseline is None:
            return pd.Series(np.nan, index=ref.index)
        b_ref, b_exp = baseline["ref_activity"].median(), baseline["exp_activity"].median()
        if not (b_ref > 0 and b_exp > 0):
            return pd.Series(np.nan, index=ref.index)
        return 100 * (1 - (exp / b_exp) / (ref / b_ref))
    return 100 * (ref - exp) / ref


def compute_signals(frame: pd.DataFrame, at: pd.Timestamp, config: dict) -> Signals:
    n = window_bins(config)
    need = max(1, int(np.ceil(config["min_valid_fraction"] * n)))
    frame = frame.loc[:at]
    window = frame.iloc[-n:]
    both = window[["ref_activity", "exp_activity"]].dropna()
    fraction = len(both) / n
    if len(both) < need:
        return Signals(False, f"Only {len(both)} of {n} expected paired readings are valid in the assessment window.", fraction)

    roll = lambda s: s.rolling(n, min_periods=need).median()  # noqa: E731
    base = baseline_slice(frame, at, config)
    ready = base[["ref_activity", "exp_activity"]].dropna().shape[0] * GRID_MINUTES / 60 >= config["baseline"]["min_hours"]
    hours = base[["ref_activity", "exp_activity"]].dropna().shape[0] * GRID_MINUTES / 60

    ref, exp = roll(frame["ref_activity"]), roll(frame["exp_activity"])
    indicator = inhibition_indicator(ref, exp, config, base if ready else None)
    sig = Signals(
        True,
        valid_fraction=fraction,
        ref_activity=_num(ref.iloc[-1]),
        exp_activity=_num(exp.iloc[-1]),
        inhibition=_num(indicator.iloc[-1]),
        baseline_ready=ready,
        baseline_hours=hours,
        indicator_series=indicator,
    )
    minimum = config["min_reference_activity"]
    if sig.ref_activity is None or sig.ref_activity <= (minimum or 0):
        return Signals(False, "Reference chamber activity is below the protocol's minimum, so no comparison is valid.", fraction, sig.ref_activity, sig.exp_activity)
    if not ready:
        return sig

    a, floor = config["anomaly"], config["anomaly"]["min_log_sd"]
    log_ratio = np.log(exp.where(exp > 0) / ref.where(ref > 0))
    base_lr = log_ratio.reindex(base.index).dropna().to_numpy()
    if len(base_lr) < 12:
        return sig
    med, sd = robust_center_scale(base_lr, floor)
    z = (log_ratio - med) / sd
    sig.z_series, sig.baseline_ratio = z, float(np.exp(med))
    sig.z_response = _num(z.iloc[-1])
    # Short-window version, used only to date the onset without the assessment window's delay.
    fast = np.log(frame["exp_activity"].where(frame["exp_activity"] > 0) / frame["ref_activity"].where(frame["ref_activity"] > 0))
    fmed, fsd = robust_center_scale(fast.reindex(base.index).dropna().to_numpy(), floor)
    sig.fast_z_series = (fast - fmed) / fsd

    base_ref = np.log(ref.where(ref > 0)).reindex(base.index).dropna().to_numpy()
    rmed, rsd = robust_center_scale(base_ref, floor)
    sig.z_reference = _num((np.log(sig.ref_activity) - rmed) / rsd)
    sig.reference_shift_pct = float(100 * (sig.ref_activity / np.exp(rmed) - 1))
    rc = config["reference_check"]
    sig.reference_suspect = (
        sig.z_reference is not None
        and abs(sig.z_reference) >= rc["z_threshold"]
        and abs(sig.reference_shift_pct) >= rc["min_shift_percent"]
    )

    # One-sided CUSUM on hourly means catches slow drift that never crosses the z threshold.
    hourly = np.log(frame["exp_activity"].where(frame["exp_activity"] > 0) / frame["ref_activity"].where(frame["ref_activity"] > 0))
    hourly = hourly.resample("1h").mean().dropna()
    hb = hourly.loc[base.index[0] : base.index[-1]].to_numpy()
    if len(hb) >= 24:
        hmed, hsd = robust_center_scale(hb, floor)
        s = 0.0
        for v in hourly.loc[at - pd.Timedelta(hours=24) :]:
            s = max(0.0, s + (hmed - v) / hsd - a["cusum_k"])
        sig.cusum = float(s)

    if sig.z_response is not None and sig.z_response <= -a["z_threshold"]:
        sig.anomaly_reasons.append("sudden")
    if sig.cusum is not None and sig.cusum >= a["cusum_h"] and sig.z_response is not None and sig.z_response <= -a["z_threshold"] / 2:
        sig.anomaly_reasons.append("drift")
    if sig.z_response is not None and sig.z_response >= a["z_threshold"]:
        sig.anomaly_reasons.append("stimulation")
    sig.anomaly = bool(sig.anomaly_reasons)
    return sig


def _num(v) -> float | None:
    return float(v) if v is not None and np.isfinite(v) else None
