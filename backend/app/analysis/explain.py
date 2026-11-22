"""Plain-language explanation, assembled only from measured or computed values."""

from typing import Any

SEVERITY_LABEL = {
    "normal": "Normal",
    "mild": "Mild inhibition",
    "moderate": "Moderate inhibition",
    "severe": "Severe inhibition",
    "unclassified": "Unclassified",
    "inconclusive": "Inconclusive",
    "insufficient": "Not enough data",
}


def _fmt(v: float | None, digits: int = 1) -> str:
    return "n/a" if v is None else f"{v:.{digits}f}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def explain(r: dict[str, Any]) -> dict[str, Any]:
    sig, sev, unit = r["signals"], r["severity"], r["activity_unit"]
    inh, ref, exp = sig["inhibition"], sig["ref_activity"], sig["exp_activity"]
    reasons = sig["anomaly_reasons"]
    strong = [f for f in r["factors"] if f["strength"] != "none"]

    if sev == "insufficient":
        headline = "Not enough valid data to assess"
        summary = sig["reason"]
        abnormality = "No assessment was made."
    elif sev == "inconclusive":
        headline = "The reference chamber has changed"
        summary = (
            f"Reference activity is {abs(sig['reference_shift_pct']):.0f}% "
            f"{'below' if sig['reference_shift_pct'] < 0 else 'above'} its own baseline. Until the control population is "
            "confirmed, a difference between chambers cannot be attributed to the wastewater sample."
        )
        abnormality = "Reference chamber activity is outside its normal range, so inhibition is not classified."
    else:
        relation = "below" if inh >= 0 else "above"
        compare = f"Activity in the exposed chamber is {abs(inh):.0f}% {relation} the reference chamber."
        if abs(inh) < 1:
            compare = "Activity in the exposed chamber matches the reference chamber."
        if sev in ("mild", "moderate", "severe"):
            headline = f"{SEVERITY_LABEL[sev]} detected"
            tail = " Further investigation of the wastewater sample is recommended."
            if strong:
                tail = f" {_join([f['label'] for f in strong[:2]])} changed over the same period. Further investigation of the wastewater sample is recommended."
            summary = compare + tail
            kind = "gradual decline" if reasons == ["drift"] else "reduction"
            abnormality = f"Sustained {kind} in exposed-chamber activity compared with the reference chamber."
        elif "stimulation" in reasons:
            headline = "Exposed activity is unusually high"
            summary = compare + " This is outside the station's normal range and may indicate a readily degradable load or a sensor fault."
            abnormality = "Exposed-chamber activity is above its normal relationship to the reference chamber."
        elif sig["anomaly"]:
            headline = "Unusual response, below the mild threshold" if sev == "normal" else "Unusual biological response"
            summary = compare + " This differs from the station's own history" + (
                "." if sev == "normal" else ", but severity is not classified because no validated thresholds apply to this station."
            )
            abnormality = "The exposed-to-reference relationship is outside its historical range."
        elif sev == "unclassified":
            headline = "No unusual response detected" if sig["baseline_ready"] else "Establishing a baseline"
            summary = compare + (
                " This is within the station's historical range. Severity is not classified because no validated thresholds apply."
                if sig["baseline_ready"]
                else f" {sig['baseline_hours']:.0f} h of baseline collected so far; anomaly detection starts after {r['baseline_min_hours']:.0f} h."
            )
            abnormality = "None detected." if sig["baseline_ready"] else "Not assessed yet."
        else:
            headline = "Biological response is normal"
            summary = compare + " This is within the normal range for this station."
            abnormality = "None detected."

    evidence = []
    if ref is not None:
        evidence.append({"label": "Reference activity", "value": f"{_fmt(ref)} {unit}", "note": "Median over the assessment window"})
    if exp is not None:
        evidence.append({"label": "Exposed activity", "value": f"{_fmt(exp)} {unit}", "note": "Median over the assessment window"})
    if inh is not None:
        evidence.append({"label": "Inhibition indicator", "value": f"{inh:.1f}%", "note": r["formula_expression"]})
    if sig["z_response"] is not None:
        evidence.append(
            {
                "label": "Difference from history",
                "value": f"{sig['z_response']:+.1f} robust SD",
                "note": f"Exposed-to-reference ratio; usually {sig['baseline_ratio']:.2f} at this station. Flagged beyond ±{r['z_threshold']:.0f}",
            }
        )
    if sig["cusum"] is not None:
        evidence.append({"label": "Accumulated drift", "value": _fmt(sig["cusum"]), "note": f"CUSUM over 24 h. Flagged above {r['cusum_h']:.0f}"})
    if sig["reference_shift_pct"] is not None:
        evidence.append(
            {"label": "Reference stability", "value": f"{sig['reference_shift_pct']:+.1f}%", "note": "Reference activity versus its own baseline"}
        )
    evidence.append({"label": "Paired readings", "value": f"{sig['valid_fraction'] * 100:.0f}%", "note": "Valid share of the assessment window"})

    return {
        "headline": headline,
        "summary": summary,
        "abnormality": abnormality,
        "evidence": evidence,
        "recommendations": recommendations(r, strong),
    }


def recommendations(r: dict[str, Any], strong: list[dict]) -> list[dict[str, str]]:
    sev, sig = r["severity"], r["signals"]
    out: list[dict[str, str]] = []
    add = lambda action, reason: out.append({"action": action, "reason": reason})  # noqa: E731
    if sev == "insufficient":
        add("Check sensor and device connectivity.", "Too few valid paired readings to compare the chambers.")
    elif sev == "inconclusive":
        add("Inspect the reference chamber.", "The control population changed, so the comparison is not reliable.")
        add("Verify reference temperature, feed and sensor condition.", "These affect both the organisms and the reading.")
        add("Re-establish the reference before acting on the exposed reading.", "Severity is withheld until the control is stable.")
    elif sev in ("mild", "moderate", "severe"):
        add("Collect a confirmatory wastewater sample.", "Laboratory analysis is needed to identify what is present.")
        if sev == "severe":
            add("Notify the responsible process and environmental personnel.", "The response is in the protocol's highest class.")
        add("Inspect the exposed monitoring chamber.", "Rules out fouling, flow blockage or a sensor fault.")
        near = [e for e in r.get("nearby_events", []) if e["kind"] == "discharge"]
        add(
            "Review recent wastewater discharge events.",
            f"{len(near)} recorded within the preceding 12 hours." if near else "None are recorded for this period; check for unlogged ones.",
        )
        if strong:
            add(f"Check the source of the change in {strong[0]['label'].lower() if strong[0]['quantity'] != 'ph' else 'pH'}.", "It changed over the same period. This is an association, not a cause.")
        else:
            add("Investigate possible inhibitory substances.", "No monitored supporting measurement moved with the response.")
    elif sig["anomaly"]:
        add("Inspect the exposed chamber and review recent events.", "The response is unusual for this station.")
        add("Collect a confirmatory sample if the change persists.", "The platform cannot rate severity without validated thresholds." if sev == "unclassified" else "The response is below the mild threshold.")
    else:
        add("Continue routine monitoring.", "No abnormal response was detected.")
    return out
