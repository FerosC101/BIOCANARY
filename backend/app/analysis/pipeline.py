"""One assessment: signals → anomaly → classification → factors → explanation."""

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd

from .explain import explain
from .factors import contributing_factors, response_onset
from .features import extract_features
from .model_runtime import Prediction
from .protocol import FORMULAS, merged, thresholds_usable
from .signals import Signals, compute_signals


@dataclass
class Context:
    origin: str
    protocol_config: dict[str, Any]
    validation_status: str
    predict: Callable[[dict[str, float]], Prediction | None]
    inference_backend: str = "local"
    events: list[dict[str, Any]] | None = None


def classify_by_threshold(value: float, t: dict[str, float]) -> str:
    if value >= t["severe"]:
        return "severe"
    if value >= t["moderate"]:
        return "moderate"
    return "mild" if value >= t["mild"] else "normal"


def model_usable(training_origin: str, origin: str) -> tuple[bool, str]:
    """A model is only applied to the kind of data it was trained on."""
    if origin == "simulated":
        if training_origin == "simulated":
            return True, "Trained on simulated data and applied to simulated data."
        return False, "Trained on experimental data; not applied to simulated readings."
    if training_origin == "experimental":
        return True, "Trained on experimental data."
    return False, "Trained on simulated data only, so it is not applied to hardware measurements."


def assess(frame: pd.DataFrame, at: pd.Timestamp, ctx: Context) -> dict[str, Any]:
    cfg = merged(ctx.protocol_config)
    sig: Signals = compute_signals(frame, at, cfg)
    t_ok, t_reason = thresholds_usable(ctx.protocol_config, ctx.validation_status, ctx.origin)

    threshold_class = model = None
    model_info: dict[str, Any] = {"used": False, "reason": "Not enough data for the model."}
    if sig.sufficient and sig.inhibition is not None:
        if t_ok:
            threshold_class = classify_by_threshold(sig.inhibition, cfg["thresholds"])
        features = extract_features(frame, at, cfg) if sig.baseline_ready else None
        if features is not None:
            try:
                model = ctx.predict(features)
            except Exception as exc:  # reported in the assessment; never replaced by another backend
                model_info = {"used": False, "reason": f"Inference failed on {ctx.inference_backend}: {type(exc).__name__}", "error": True}
            else:
                if model is None:
                    model_info = {"used": False, "reason": "No model artifact is available."}
                else:
                    ok, why = model_usable(model.training_origin, ctx.origin)
                    model_info = {"used": ok, "reason": why, "backend": ctx.inference_backend, "version": model.model_version, "features": {k: round(v, 4) for k, v in features.items()}}
                    if ok:
                        model_info["prediction"] = model.to_dict()
                    else:
                        model = None

    if not sig.sufficient or sig.inhibition is None:
        severity, method = "insufficient", "none"
        if not sig.reason:
            sig.reason = f"The configured formula needs a baseline of at least {cfg['baseline']['min_hours']:.0f} hours."
    elif sig.reference_suspect:
        severity, method = "inconclusive", "reference check"
    elif threshold_class:
        severity, method = threshold_class, "protocol thresholds"
    elif model:
        severity, method = model.label, "trained model"
    else:
        severity, method = "unclassified", "none"

    confidence, confidence_reason = None, "No calibrated model applies to this data."
    if model and severity in model.probabilities:
        if model.confidence is None:
            confidence_reason = "The model's probabilities are not calibrated."
        else:
            confidence = model.probabilities[severity]
            confidence_reason = "Calibrated model probability for the assigned class" + (
                ", calibrated on simulated data." if model.training_origin == "simulated" else "."
            )
    elif severity in ("inconclusive", "insufficient"):
        confidence_reason = "Severity was withheld."

    abnormal = severity in ("mild", "moderate", "severe") or (sig.anomaly and severity != "inconclusive")
    factors = contributing_factors(frame, at, sig, cfg) if abnormal else []
    onset = response_onset(sig) if abnormal else None
    nearby = []
    if abnormal:
        begin = (onset or at) - pd.Timedelta(hours=12)
        nearby = [e for e in (ctx.events or []) if begin <= pd.Timestamp(e["occurred_at"]) <= at]

    signals = {k: v for k, v in asdict(_strip(sig)).items() if k not in ("indicator_series", "z_series", "fast_z_series")}
    result: dict[str, Any] = {
        "data_until": at.isoformat(),
        "origin": ctx.origin,
        "severity": severity,
        "method": method,
        "anomaly": sig.anomaly,
        "onset": onset.isoformat() if onset is not None else None,
        "signals": signals,
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "threshold": {"used": t_ok, "class": threshold_class, "reason": t_reason, "values": cfg["thresholds"]},
        "model": model_info,
        "agreement": None if not (threshold_class and model) else threshold_class == model.label,
        "factors": factors,
        "nearby_events": nearby,
        "activity_unit": cfg["activity"].get("unit", ""),
        "formula": cfg["formula"],
        "formula_expression": FORMULAS[cfg["formula"]]["expression"],
        "z_threshold": cfg["anomaly"]["z_threshold"],
        "cusum_h": cfg["anomaly"]["cusum_h"],
        "baseline_min_hours": cfg["baseline"]["min_hours"],
    }
    result["explanation"] = explain(result)
    return result


def _strip(sig: Signals) -> Signals:
    sig.indicator_series = sig.z_series = sig.fast_z_series = None
    return sig
