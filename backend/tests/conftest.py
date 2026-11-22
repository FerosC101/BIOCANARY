import os
import tempfile

_dir = tempfile.mkdtemp()
os.environ.setdefault("BIOCANARY_DATABASE_URL", f"sqlite:///{_dir}/test.db")
os.environ["BIOCANARY_OBJECT_DIR"] = f"{_dir}/objects"
os.environ["BIOCANARY_RUN_BACKGROUND_WORKER"] = "false"
os.environ["BIOCANARY_ENVIRONMENT"] = "local"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.analysis.protocol import DEFAULT_CONFIG  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Device, Facility, Protocol, Station, User  # noqa: E402
from app.security import hash_device_key, hash_password  # noqa: E402
from app.simulation.seed import add_sensors  # noqa: E402

KEY = "bck_test_key"
DEMO_THRESHOLDS = {"mild": 10.0, "moderate": 25.0, "severe": 50.0}


@pytest.fixture
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.cloud.registry import get_cache

    get_cache.cache_clear()
    with SessionLocal() as s:
        f = Facility(name="F", timezone="Asia/Manila")
        demo = Protocol(name="demo", validation_status="demonstration", config={**DEFAULT_CONFIG, "thresholds": DEMO_THRESHOLDS})
        raw = Protocol(name="raw", validation_status="unvalidated", config=DEFAULT_CONFIG)
        for code, origin, protocol in (("SIM", "simulated", demo), ("LIVE", "live", raw)):
            st = Station(code=code, name=code, origin=origin, facility=f, protocol=protocol, sim_profile={"seed": 5, "event_rate": 0})
            add_sensors(st)
            st.devices.append(Device(code=f"{code}-D", key_hash=hash_device_key(KEY)))
            s.add(st)
        s.add(User(email="a@x.test", name="Admin", role="admin", password_hash=hash_password("correct horse")))
        s.add(User(email="o@x.test", name="Op", role="operator", password_hash=hash_password("correct horse")))
        s.commit()
        yield s


@pytest.fixture
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin(client):
    assert client.post("/api/v1/auth/login", json={"email": "a@x.test", "password": "correct horse"}).status_code == 200
    return client
