"""Experimental protocol configuration.

Nothing here asserts a biological method. It declares which measured quantity is *treated as*
biological activity, which arithmetic converts two chamber activities into an inhibition indicator,
and which class boundaries apply. All of it is stored per protocol and editable, and class boundaries
have no default: an unvalidated protocol produces an indicator but no severity class.
"""

import copy
from typing import Any

SEVERITIES = ("normal", "mild", "moderate", "severe")
# Results that are deliberately not a severity class.
WITHHELD = ("unclassified", "inconclusive", "insufficient")

FORMULAS = {
    "percent_difference": {
        "label": "Percent difference from reference",
        "expression": "I = 100 × (A_ref − A_exp) / A_ref",
        "note": "Assumes both chambers read the same when neither is inhibited.",
    },
    "baseline_normalised": {
        "label": "Baseline-normalised difference",
        "expression": "I = 100 × (1 − (A_exp / B_exp) / (A_ref / B_ref))",
        "note": "B is each chamber's median activity over the baseline period; removes a fixed chamber-to-chamber offset.",
    },
}

ACTIVITY_SOURCES = {
    "direct": "The device reports a biological activity value for each chamber.",
    "do_uptake_rate": (
        "Activity is the rate of dissolved-oxygen decline, from a linear fit over the window. "
        "Only meaningful if the chamber is closed to aeration during that window."
    ),
}

DEFAULT_CONFIG: dict[str, Any] = {
    "activity": {"source": "direct", "quantity": "biological_activity", "unit": "a.u.", "window_minutes": 30},
    "formula": "percent_difference",
    "assessment_window_minutes": 60,
    "min_valid_fraction": 0.5,
    "min_reference_activity": None,
    "baseline": {"days": 7, "guard_hours": 6, "min_hours": 24},
    "anomaly": {"z_threshold": 4.0, "cusum_k": 0.5, "cusum_h": 8.0, "min_log_sd": 0.01},
    "reference_check": {"z_threshold": 6.0, "min_shift_percent": 8.0},
    "thresholds": {"mild": None, "moderate": None, "severe": None},
}


def merged(config: dict[str, Any] | None) -> dict[str, Any]:
    out = copy.deepcopy(DEFAULT_CONFIG)
    for key, value in (config or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key].update(value)
        else:
            out[key] = value
    return out


def validate(config: dict[str, Any], validation_status: str) -> list[str]:
    cfg = merged(config)
    problems = []
    if cfg["formula"] not in FORMULAS:
        problems.append(f"formula must be one of {', '.join(FORMULAS)}")
    if cfg["activity"].get("source") not in ACTIVITY_SOURCES:
        problems.append(f"activity source must be one of {', '.join(ACTIVITY_SOURCES)}")
    t = cfg["thresholds"]
    values = [t.get("mild"), t.get("moderate"), t.get("severe")]
    if any(v is None for v in values):
        if any(v is not None for v in values):
            problems.append("set all three thresholds or none")
        if validation_status == "validated":
            problems.append("a validated protocol needs mild, moderate and severe thresholds")
    elif not (0 < values[0] < values[1] < values[2] <= 100):
        problems.append("thresholds must increase: 0 < mild < moderate < severe <= 100")
    return problems


def thresholds_usable(config: dict[str, Any], validation_status: str, origin: str) -> tuple[bool, str]:
    """May this protocol's class boundaries be applied to data of this origin?"""
    if any(v is None for v in merged(config)["thresholds"].values()):
        return False, "The protocol defines no class thresholds."
    if validation_status == "validated":
        return True, "Thresholds from a validated protocol."
    if validation_status == "demonstration" and origin == "simulated":
        return True, "Demonstration thresholds, applied to simulated data only."
    return False, "The protocol's thresholds have not been experimentally validated."
