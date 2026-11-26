from datetime import timedelta

import pytest
from sqlalchemy import select

from app.db import utcnow
from app.models import Alert, Measurement, Station
from app.simulation import engine
from app.simulation.seed import _history
from tests.conftest import KEY

H = {"X-Device-Id": "LIVE-D", "X-Device-Key": KEY}
SIM = {"X-Device-Id": "SIM-D", "X-Device-Key": KEY}


def body(station="LIVE", at=None, values=None, **kw):
    v = {"REF-ACT": 41.0, "EXP-ACT": 40.0, **(values or {})}
    return {"schema_version": "1.0", "station_id": station, "recorded_at": (at or utcnow()).isoformat(), "partial": True, "measurements": [{"sensor_id": k, "value": x} for k, x in v.items()], **kw}


def quality(resp):
    return {m["sensor_id"]: m["quality"] for m in resp.json()["measurements"]}


def test_pages_require_sign_in(client):
    for path in ("/stations", "/stations/SIM/overview", "/reports", "/system/status", "/model", "/stream"):
        assert client.get("/api/v1" + path).status_code == 401


def test_login_and_rate_limit(client):
    bad = {"email": "a@x.test", "password": "nope"}
    assert client.post("/api/v1/auth/login", json=bad).status_code == 401
    codes = [client.post("/api/v1/auth/login", json=bad).status_code for _ in range(11)]
    assert codes[-1] == 429


def test_device_auth(client):
    assert client.post("/api/v1/ingest/readings", json=body(), headers={**H, "X-Device-Key": "wrong"}).status_code == 401
    assert client.post("/api/v1/ingest/readings", json=body()).status_code == 422
    r = client.post("/api/v1/ingest/readings", json=body("SIM"), headers=H)
    assert r.status_code == 422 and "not assigned" in r.json()["detail"]


def test_ingest_stores_with_station_origin_and_is_idempotent(client, db):
    b = body()
    assert client.post("/api/v1/ingest/readings", json=b, headers=H).json()["stored"] == 2
    again = client.post("/api/v1/ingest/readings", json=b, headers=H)
    assert again.status_code == 202 and again.json()["stored"] == 0
    rows = db.scalars(select(Measurement)).all()
    assert len(rows) == 2 and {m.origin for m in rows} == {"live"}


def test_quality_rules(client):
    t = utcnow() - timedelta(minutes=30)
    post = lambda at, v: client.post("/api/v1/ingest/readings", json=body(at=at, values=v), headers=H)  # noqa: E731
    assert quality(post(t, {"ENV-PH": 7.1, "ENV-TEMP": -127, "ENV-DO": None})) == {"REF-ACT": "valid", "EXP-ACT": "valid", "ENV-PH": "valid", "ENV-TEMP": "invalid", "ENV-DO": "missing"}
    assert quality(post(t + timedelta(minutes=10), {"ENV-PH": 3.0}))["ENV-PH"] == "suspect"
    assert quality(post(t + timedelta(minutes=20), {"ENV-PH": 3.1}))["ENV-PH"] == "valid"  # the change persisted


def test_rejections(client):
    r = client.post("/api/v1/ingest/readings", json=body(values={"NOPE": 1}), headers=H).json()
    assert next(m for m in r["measurements"] if m["sensor_id"] == "NOPE")["result"] == "rejected"
    b = body()
    b["measurements"] = [{"sensor_id": "EXP-DO", "value": 5, "unit": "ppm"}]
    assert "unit must be" in client.post("/api/v1/ingest/readings", json=b, headers=H).json()["measurements"][0]["reason"]
    assert client.post("/api/v1/ingest/readings", json=body(at=utcnow() + timedelta(hours=1)), headers=H).status_code == 422
    naive = body()
    naive["recorded_at"] = "2026-01-01T00:00:00"
    assert client.post("/api/v1/ingest/readings", json=naive, headers=H).status_code == 422
    assert client.post("/api/v1/ingest/readings", json={**body(), "junk": 1}, headers=H).status_code == 422


def test_absent_sensors_are_recorded_as_missing(client, db):
    b = body()
    b["partial"] = False
    client.post("/api/v1/ingest/readings", json=b, headers=H)
    missing = db.scalars(select(Measurement).where(Measurement.quality == "missing")).all()
    assert len(missing) == len(engine.CODES) - 2


def test_batch_accepts_good_and_reports_bad(client):
    now = utcnow()
    r = client.post("/api/v1/ingest/batch", json={"readings": [body(at=now - timedelta(minutes=10)), body(at=now + timedelta(days=1)), body(at=now)]}, headers=H)
    assert [x["accepted"] for x in r.json()] == [True, True, False]


def test_empty_station_is_offline_without_invented_values(admin):
    o = admin.get("/api/v1/stations/LIVE/overview").json()
    assert o["station"]["status"] == "offline" and o["assessment"] is None and not o["series"]["has_data"]
    assert all(s["latest"] is None and s["connection"] == "never" for s in o["sensors"])
    assert admin.post("/api/v1/stations/LIVE/analysis/run").status_code == 409


@pytest.fixture
def history(db):
    st = db.scalar(select(Station).where(Station.code == "SIM"))
    end = utcnow() - timedelta(minutes=5)
    _history(db, st, end - timedelta(days=9), end)
    return st


def test_event_flows_from_device_to_alert_to_report(admin, db, history):
    now = utcnow()
    event = {"start": (now - timedelta(hours=5)).isoformat(), "hours": 9, "peak": 60, "kind": "ph"}
    profile = {**history.sim_profile, "events": [event]}
    db.query(Measurement).filter(Measurement.recorded_at >= now - timedelta(hours=6)).delete()
    db.commit()
    from app.simulation.device import payload

    times = engine.grid_times(now - timedelta(hours=6), now, 600)
    r = admin.post("/api/v1/ingest/batch", json={"readings": [payload("SIM", profile, t, i) for i, t in enumerate(times)]}, headers=SIM)
    assert r.status_code == 202

    o = admin.get("/api/v1/stations/SIM/overview").json()
    assert o["station"]["status"] == "critical" and o["assessment"]["severity"] == "severe"
    assert o["assessment"]["detail"]["model"]["prediction"]["training_origin"] == "simulated"
    alert = next(a for a in o["alerts"] if a["kind"] == "inhibition")
    assert alert["level"] == "critical" and alert["ended_at"] is None
    an = admin.get("/api/v1/stations/SIM/analysis").json()
    assert an["assessment"]["detail"]["factors"][0]["quantity"] == "ph" and an["patterns"]["episode_count"] == 1
    assert admin.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"note": "sampling"}).json()["acknowledged_by"] == "Admin"
    db.expire_all()
    assert db.scalars(select(Alert)).one().origin == "simulated"

    period = {"start": (now - timedelta(days=2)).isoformat(), "end": now.isoformat()}
    rep = admin.get("/api/v1/stations/SIM/report", params=period).json()
    assert rep["events"][0]["severity"] == "severe" and rep["performance"]["paired"] > 0.9
    assert admin.get("/api/v1/stations/SIM/report", params={**period, "severity": "mild"}).json()["events"] == []
    for fmt, magic in (("pdf", b"%PDF"), ("csv", b"\xef\xbb\xbftimestamp_utc")):
        made = admin.post("/api/v1/reports", json={"station": "SIM", **period, "format": fmt}).json()
        assert "SIMULATED" in made["filename"]
        data = admin.get(f"/api/v1/reports/{made['id']}/download").content
        assert data.startswith(magic)
    assert b"simulated" in data
    # Include options: sections can be left out of the PDF, and "raw" lists individual readings with quality.
    slim = admin.post("/api/v1/reports", json={"station": "SIM", **period, "format": "pdf", "include": []}).json()
    full = admin.post("/api/v1/reports", json={"station": "SIM", **period, "format": "pdf"}).json()
    assert slim["size_bytes"] < full["size_bytes"]
    raw = admin.post("/api/v1/reports", json={"station": "SIM", **period, "format": "csv", "include": ["raw"]}).json()
    rows = admin.get(f"/api/v1/reports/{raw['id']}/download").content.decode("utf-8-sig").splitlines()
    assert rows[0].startswith("recorded_utc,") and ",valid," in rows[1]
    assert admin.post("/api/v1/reports", json={"station": "SIM", **period, "format": "pdf", "include": ["nope"]}).status_code == 422


def test_gap_and_series_are_null_not_interpolated(admin, db, history):
    cut = utcnow() - timedelta(hours=3)
    db.query(Measurement).filter(Measurement.recorded_at >= cut - timedelta(hours=1), Measurement.recorded_at <= cut).delete()
    db.commit()
    s = admin.get("/api/v1/stations/SIM/series", params={"start": (cut - timedelta(hours=4)).isoformat(), "end": utcnow().isoformat()}).json()
    assert None in s["channels"]["ref_activity"]


def test_only_admin_changes_protocol(admin, client, db):
    p = admin.get("/api/v1/stations/LIVE/protocol").json()
    bad = {"validation_status": "validated", "validation_reference": "", "config": p["config"]}
    assert admin.put(f"/api/v1/protocols/{p['id']}", json=bad).status_code == 422
    good = {"validation_status": "validated", "validation_reference": "Lab record 12", "config": {**p["config"], "thresholds": {"mild": 12, "moderate": 30, "severe": 55}}}
    assert admin.put(f"/api/v1/protocols/{p['id']}", json=good).json()["version"] == "2"
    client.post("/api/v1/auth/login", json={"email": "o@x.test", "password": "correct horse"})
    assert client.put(f"/api/v1/protocols/{p['id']}", json=good).status_code == 403


def test_events_are_validated(admin):
    post = lambda at: admin.post("/api/v1/stations/SIM/events", json={"occurred_at": at.isoformat(), "kind": "discharge", "note": "x"})  # noqa: E731
    assert post(utcnow()).status_code == 201
    assert post(utcnow() + timedelta(days=1)).status_code == 422


def test_quality_grid_keeps_the_worst_state_per_cell(admin):
    t = utcnow() - timedelta(minutes=50)
    admin.post("/api/v1/ingest/readings", json=body(at=t, values={"ENV-TEMP": 22.0}), headers=H)
    admin.post("/api/v1/ingest/readings", json=body(at=t + timedelta(minutes=10), values={"ENV-TEMP": -127}), headers=H)
    start = (t - timedelta(minutes=10)).isoformat()
    end = (t + timedelta(minutes=50)).isoformat()
    r = admin.get("/api/v1/stations/LIVE/quality", params={"start": start, "end": end, "cells": 6})
    assert r.status_code == 200
    rows = {s["code"]: s for s in r.json()["sensors"]}
    assert rows["ENV-TEMP"]["cells"][1:3] == ["valid", "invalid"]
    assert rows["ENV-TEMP"]["valid"] == 0.5
    assert rows["ENV-PH"]["cells"] == ["none"] * 6 and rows["ENV-PH"]["valid"] is None
