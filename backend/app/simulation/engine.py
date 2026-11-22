"""Deterministic simulator for demonstration stations.

Every value is a pure function of (station seed, time), so seeded history and the live device
simulator join without a step. These are invented dynamics for exercising the software. They are not
a model of any organism, toxicant or wastewater, and everything generated is stored with
origin="simulated".
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

STEP = 15  # seconds between independent noise samples
KINDS = ("conductivity", "ph", "flow", "unattributed")

SENSORS = [
    # code, name, location, quantity, unit, min, max, max_step
    ("REF-ACT", "Reference activity", "reference", "biological_activity", "a.u.", 0, 200, 25),
    ("REF-DO", "Reference dissolved oxygen", "reference", "dissolved_oxygen", "mg/L", 0, 20, 3),
    ("REF-TEMP", "Reference temperature", "reference", "temperature", "°C", 0, 60, 4),
    ("EXP-ACT", "Exposed activity", "exposed", "biological_activity", "a.u.", 0, 200, 30),
    ("EXP-DO", "Exposed dissolved oxygen", "exposed", "dissolved_oxygen", "mg/L", 0, 20, 3),
    ("EXP-TEMP", "Exposed temperature", "exposed", "temperature", "°C", 0, 60, 4),
    ("ENV-PH", "Wastewater pH", "environment", "ph", "pH", 0, 14, 2),
    ("ENV-TEMP", "Wastewater temperature", "environment", "temperature", "°C", 0, 60, 4),
    ("ENV-DO", "Wastewater dissolved oxygen", "environment", "dissolved_oxygen", "mg/L", 0, 20, 3),
    ("ENV-COND", "Wastewater conductivity", "environment", "conductivity", "µS/cm", 0, 20000, 1500),
    ("ENV-FLOW", "Wastewater flow", "environment", "flow", "m³/h", 0, 2000, 80),
]
CODES = [s[0] for s in SENSORS]


@dataclass
class Event:
    start: datetime
    hours: float
    peak: float  # latent inhibition, percent
    kind: str
    lead_minutes: float = 35


def scheduled_events(profile: dict, first: datetime, last: datetime) -> list[Event]:
    out = [
        Event(datetime.fromisoformat(e["start"]), e["hours"], e["peak"], e["kind"], e.get("lead_minutes", 35))
        for e in profile.get("events", [])
    ]
    quiet_from = datetime.fromisoformat(profile["quiet_from"]) if profile.get("quiet_from") else None
    quiet_to = datetime.fromisoformat(profile["quiet_to"]) if profile.get("quiet_to") else None
    day = (first - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= last:
        rng = np.random.default_rng([profile["seed"], day.toordinal()])
        if rng.random() < profile.get("event_rate", 0.2):
            start = day + timedelta(minutes=float(rng.uniform(120, 1200)))
            band = rng.choice(3, p=[0.45, 0.38, 0.17])
            peak = float(rng.uniform(*[(13, 22), (28, 45), (55, 72)][band]))
            if "peak_range" in profile:  # continuous peaks, so training data covers the class boundaries
                peak = float(rng.uniform(*profile["peak_range"]))
            event = Event(start, float(rng.uniform(3, 8)), peak, str(rng.choice(KINDS, p=[0.35, 0.25, 0.2, 0.2])), float(rng.uniform(20, 60)))
            if not (quiet_from and quiet_to and quiet_from <= start <= quiet_to):
                out.append(event)
        day += timedelta(days=1)
    return out


def _shape(t: np.ndarray, start: float, hours: float) -> np.ndarray:
    rise = np.clip((t - start) / (45 * 60), 0, 1)
    rise = rise * rise * (3 - 2 * rise)
    end = start + hours * 3600
    return np.where(t <= end, rise, rise * np.exp(-np.maximum(t - end, 0) / (80 * 60)))


def _noise(seed: int, t: np.ndarray) -> np.ndarray:
    """(len(t), n_sensors) standard normals, reproducible for any timestamp."""
    slot = (t // STEP).astype(np.int64)
    per_day = 86400 // STEP
    out = np.empty((len(t), len(CODES)))
    for day in np.unique(slot // per_day):
        table = np.random.default_rng([seed, 7, int(day)]).standard_normal((per_day, len(CODES)))
        mask = slot // per_day == day
        out[mask] = table[slot[mask] % per_day]
    return out


def _wander(seed: int, stream: int, t: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng([seed, 11, stream])
    periods, phases = rng.uniform(6, 70, 5) * 3600, rng.uniform(0, 2 * np.pi, 5)
    return np.sin(2 * np.pi * t[:, None] / periods + phases).sum(1) / np.sqrt(5)


def generate(profile: dict, times: list[datetime]) -> tuple[dict[str, np.ndarray], np.ndarray]:
    """Returns sensor values (NaN = the device reports the value as missing) and latent inhibition (%)."""
    t = np.array([x.timestamp() for x in times])
    seed = profile["seed"]
    e = _noise(seed, t)
    hour = (t / 3600) % 24

    latent = np.zeros(len(t))
    cond = ph = flow = do_env = np.zeros(len(t))
    for ev in scheduled_events(profile, times[0], times[-1]):
        s = ev.start.timestamp()
        latent = np.maximum(latent, ev.peak * _shape(t, s, ev.hours))
        pre = _shape(t, s - ev.lead_minutes * 60, max(0.8, ev.hours * 0.8)) * ev.peak / 40
        if ev.kind == "conductivity":
            cond = cond + 420 * pre
        elif ev.kind == "ph":
            ph = ph - 0.9 * pre
        elif ev.kind == "flow":
            flow = flow + 26 * pre
            do_env = do_env - 0.5 * pre

    common = 1 + 0.015 * _wander(seed, 0, t)
    level, rough = profile.get("level", 42.0), profile.get("noise", 1.0)
    ref = level * common * (1 + 0.008 * rough * _wander(seed, 1, t)) * (1 + 0.014 * rough * e[:, 0])
    for d in profile.get("reference_disturbances", []):
        ref = ref * (1 - d["drop"] / 100 * _shape(t, datetime.fromisoformat(d["start"]).timestamp(), d["hours"]))
    offset = profile.get("chamber_offset", 0.985)
    exp = level * offset * common * (1 + 0.010 * rough * _wander(seed, 2, t)) * (1 + 0.018 * rough * e[:, 3]) * (1 - latent / 100)

    diurnal = np.sin(2 * np.pi * (hour - 9) / 24)
    values = {
        "REF-ACT": ref,
        "REF-DO": 8.1 - 0.055 * ref + 0.05 * e[:, 1],
        "REF-TEMP": 25.0 + 0.10 * _wander(seed, 3, t) + 0.04 * e[:, 2],
        "EXP-ACT": exp,
        "EXP-DO": 8.1 - 0.055 * exp + 0.06 * e[:, 4],
        "EXP-TEMP": 25.0 + 0.12 * _wander(seed, 4, t) + 0.05 * e[:, 5],
        "ENV-PH": 7.25 + 0.08 * _wander(seed, 5, t) + 0.03 * diurnal + 0.02 * e[:, 6] + ph,
        "ENV-TEMP": 23.4 + 0.9 * diurnal + 0.35 * _wander(seed, 6, t) + 0.05 * e[:, 7],
        "ENV-DO": 2.4 + 0.22 * _wander(seed, 7, t) - 0.15 * diurnal + 0.05 * e[:, 8] + do_env,
        "ENV-COND": 1180 + 45 * _wander(seed, 8, t) + 35 * diurnal + 9 * e[:, 9] + cond,
        "ENV-FLOW": 84 + 13 * diurnal + 3.5 * _wander(seed, 9, t) + 1.3 * e[:, 10] + flow,
    }
    _faults(profile, t, values)
    return {k: np.round(v, 3) for k, v in values.items()}, latent


def _faults(profile: dict, t: np.ndarray, values: dict[str, np.ndarray]) -> None:
    """Dropouts (missing) and disconnected-probe readings (out of range → invalid)."""
    if not profile.get("faults", True):
        return
    for day in np.unique(t // 86400).astype(int):
        rng = np.random.default_rng([profile["seed"], 13, int(day)])
        if rng.random() < 0.14:
            code = str(rng.choice(["ENV-PH", "ENV-COND", "EXP-TEMP", "REF-DO", "ENV-DO"]))
            s = day * 86400 + rng.uniform(0, 80000)
            values[code] = np.where((t >= s) & (t <= s + rng.uniform(1800, 5400)), np.nan, values[code])
        if rng.random() < 0.10:
            s = day * 86400 + rng.uniform(0, 80000)
            values["ENV-TEMP"] = np.where((t >= s) & (t <= s + 1800), -127.0, values["ENV-TEMP"])


def grid_times(start: datetime, end: datetime, seconds: int) -> list[datetime]:
    first = int(np.ceil(start.timestamp() / seconds)) * seconds
    return [datetime.fromtimestamp(x, UTC) for x in range(first, int(end.timestamp()) + 1, seconds)]
