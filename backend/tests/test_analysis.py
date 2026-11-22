import numpy as np
import pandas as pd
import pytest

from app.analysis.frame import uptake_rate
from app.analysis.model_runtime import Prediction
from app.analysis.pipeline import Context, assess, classify_by_threshold
from app.analysis.protocol import DEFAULT_CONFIG, merged, thresholds_usable, validate
from app.analysis.signals import inhibition_indicator

T = {"mild": 10.0, "moderate": 25.0, "severe": 50.0}
CFG = {**DEFAULT_CONFIG, "thresholds": T}


def frame(days=9, drop=0.0, hours=3, ref_drop=0.0, seed=1, env=None):
    idx = pd.date_range("2026-01-01", periods=days * 144, freq="10min", tz="UTC")
    rng = np.random.default_rng(seed)
    ref = 40 * (1 + 0.012 * rng.standard_normal(len(idx)))
    exp = 40 * (1 + 0.012 * rng.standard_normal(len(idx)))
    tail = int(hours * 6)
    exp[-tail:] *= 1 - drop
    ref[-tail:] *= 1 - ref_drop
    f = pd.DataFrame({"ref_activity": ref, "exp_activity": exp}, index=idx)
    f["env_ph"] = 7.2 + 0.03 * rng.standard_normal(len(idx))
    if env:
        f.iloc[-tail - 3 :, f.columns.get_loc("env_ph")] += env
    return f


def ctx(origin="simulated", status="demonstration", config=CFG, training="simulated", fail=False):
    def predict(_):
        if fail:
            raise RuntimeError("endpoint down")
        return Prediction("moderate", {"normal": 0.05, "mild": 0.15, "moderate": 0.7, "severe": 0.1}, 0.7, "m1", training)

    return Context(origin, config, status, predict)


def run(f, c):
    return assess(f, f.index[-1], c)


def test_percent_difference_and_stimulation_is_not_clipped():
    s = inhibition_indicator(pd.Series([40.0, 40.0]), pd.Series([30.0, 44.0]), merged(CFG))
    assert s.tolist() == pytest.approx([25.0, -10.0])


def test_baseline_normalised_removes_chamber_offset():
    cfg = merged({**CFG, "formula": "baseline_normalised"})
    base = pd.DataFrame({"ref_activity": [40.0] * 5, "exp_activity": [36.0] * 5})
    assert inhibition_indicator(pd.Series([40.0]), pd.Series([36.0]), cfg, base)[0] == pytest.approx(0)
    assert inhibition_indicator(pd.Series([40.0]), pd.Series([18.0]), cfg, base)[0] == pytest.approx(50)


def test_low_reference_activity_gives_no_indicator():
    cfg = merged({**CFG, "min_reference_activity": 10})
    assert np.isnan(inhibition_indicator(pd.Series([5.0]), pd.Series([1.0]), cfg)[0])


def test_uptake_rate_is_decline_per_hour():
    do = pd.Series(8 - 0.5 * np.arange(7) / 6 * 1.0)  # 0.5 mg/L per hour on a 10-minute grid
    assert uptake_rate(do, 30).iloc[-1] == pytest.approx(0.5)


@pytest.mark.parametrize(("v", "c"), [(-5, "normal"), (9.99, "normal"), (10, "mild"), (25, "moderate"), (50, "severe")])
def test_threshold_edges(v, c):
    assert classify_by_threshold(v, T) == c


def test_normal_response():
    r = run(frame(), ctx())
    assert r["severity"] == "normal" and not r["anomaly"] and r["factors"] == []


@pytest.mark.parametrize(("drop", "sev"), [(0.15, "mild"), (0.35, "moderate"), (0.6, "severe")])
def test_inhibition_is_classified(drop, sev):
    r = run(frame(drop=drop), ctx())
    assert r["severity"] == sev and r["anomaly"]
    assert r["signals"]["inhibition"] == pytest.approx(drop * 100, abs=2.5)
    assert r["explanation"]["recommendations"]


def test_false_alarm_rate_on_quiet_data():
    f = frame(days=21, seed=4)
    flagged = sum(assess(f.iloc[:i], f.index[i - 1], ctx())["anomaly"] for i in range(144 * 9, len(f), 12))
    assert flagged / ((len(f) - 144 * 9) / 12) < 0.03


def test_reference_failure_withholds_severity():
    r = run(frame(ref_drop=0.3), ctx())
    assert r["severity"] == "inconclusive" and r["confidence"] is None


def test_shared_decline_is_not_reported_as_inhibition():
    r = run(frame(drop=0.3, ref_drop=0.3), ctx())
    assert r["severity"] == "inconclusive"


def test_live_data_never_uses_demonstration_thresholds_or_simulated_model():
    r = run(frame(drop=0.6), ctx(origin="live"))
    assert r["severity"] == "unclassified" and r["anomaly"]
    assert r["threshold"]["used"] is False and r["model"]["used"] is False
    assert r["confidence"] is None and "prediction" not in r["model"]


def test_live_data_with_validated_protocol_is_classified():
    r = run(frame(drop=0.6), ctx(origin="live", status="validated"))
    assert r["severity"] == "severe" and r["method"] == "protocol thresholds" and r["confidence"] is None


def test_experimental_model_is_not_applied_to_simulated_data():
    assert run(frame(drop=0.3), ctx(training="experimental"))["model"]["used"] is False


def test_inference_failure_is_reported_not_hidden():
    r = run(frame(drop=0.3), ctx(fail=True))
    assert r["model"]["error"] and "failed" in r["model"]["reason"] and r["confidence"] is None


def test_confidence_is_for_the_assigned_class():
    r = run(frame(drop=0.15), ctx())
    assert r["severity"] == "mild" and r["confidence"] == 0.15 and r["agreement"] is False


def test_missing_data_is_not_assessed():
    f = frame()
    f.iloc[-5:, 1] = np.nan
    assert run(f, ctx())["severity"] == "insufficient"


def test_short_history_has_no_anomaly_claim():
    r = run(frame(days=1), ctx(origin="live", status="unvalidated", config=DEFAULT_CONFIG))
    assert r["severity"] == "unclassified" and not r["signals"]["baseline_ready"]
    assert "baseline" in r["explanation"]["headline"].lower()


def test_factor_is_association_only():
    r = run(frame(drop=0.35, env=-0.9), ctx())
    ph = next(f for f in r["factors"] if f["quantity"] == "ph")
    assert ph["strength"] != "none" and ph["lead_minutes"] is not None
    assert run(frame(drop=0.35), ctx())["factors"][0]["strength"] == "none"
    assert "cause" not in r["explanation"]["summary"].lower()


def test_onset_is_dated_to_the_step_not_the_smoothed_crossing():
    f = frame(drop=0.35, hours=3)
    onset = pd.Timestamp(run(f, ctx())["onset"])
    assert abs(onset - f.index[-18]) <= pd.Timedelta(minutes=20)


def test_detection_delay_is_about_half_the_window():
    f = frame(drop=0.6, hours=3)
    start = len(f) - 18
    first = next(i for i in range(start, len(f)) if assess(f.iloc[: i + 1], f.index[i], ctx())["anomaly"])
    assert 2 <= first - start + 1 <= 4  # 20 to 40 minutes on the 10-minute grid


def test_protocol_rules():
    assert validate({"thresholds": {"mild": 30, "moderate": 20, "severe": 50}}, "demonstration")
    assert validate(DEFAULT_CONFIG, "validated")
    assert not validate(CFG, "demonstration")
    assert thresholds_usable(CFG, "demonstration", "live")[0] is False
    assert thresholds_usable(CFG, "validated", "live")[0] is True
