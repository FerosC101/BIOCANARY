import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import fakeredis
import httpx
import pytest

from app.cloud import registry
from app.cloud.cache import MemoryCache, RedisCache
from app.cloud.inference import ModelArtsInference
from app.cloud.objects import FilesystemStore, ObsStore
from app.config import DEV_SECRET, Settings

FEATURES = {"log_ratio": -0.45, "delta_1h": -0.02, "delta_3h": -0.3, "ratio_sd": 0.05, "do_gap": 0.8, "ref_shift": 0.0, "temp_gap": 0.0}


def fake_redis():
    server = fakeredis.FakeServer()
    return RedisCache(
        "", "huawei_dcs", client=fakeredis.FakeRedis(server=server, decode_responses=True),
        async_client_factory=lambda: fakeredis.FakeAsyncRedis(server=server, decode_responses=True),
    )


@pytest.mark.parametrize("cache", [MemoryCache(), fake_redis()], ids=["memory", "redis"])
def test_cache_contract(cache):
    cache.set("k", {"a": 1}, ttl=30)
    assert cache.get("k") == {"a": 1}
    cache.delete("k")
    assert cache.get("k") is None
    assert [cache.incr("n", 60) for _ in range(3)] == [1, 2, 3]
    assert cache.lock("l", 60) and not cache.lock("l", 60)


class FakeObs:
    def __init__(self):
        self.data = {}

    def putContent(self, bucket, key, content, metadata):
        self.data[key] = content
        return SimpleNamespace(status=200)

    def getObject(self, bucket, key, loadStreamInMemory):
        return SimpleNamespace(status=200, body=SimpleNamespace(buffer=self.data[key]))

    def headBucket(self, bucket):
        return SimpleNamespace(status=403, errorCode="AccessDenied")


def test_object_stores(tmp_path):
    obs = ObsStore("https://obs", "b", "", "", client=FakeObs())
    for store in (FilesystemStore(str(tmp_path)), obs):
        store.put("reports/a.pdf", b"x", "application/pdf")
        assert store.get("reports/a.pdf") == b"x"
    with pytest.raises(RuntimeError, match="403"):
        obs.probe()
    with pytest.raises(ValueError, match="escapes"):
        FilesystemStore(str(tmp_path)).put("../../evil", b"x", "text/plain")
    with pytest.raises(ValueError, match="missing"):
        ObsStore("", "", "", "")


def test_unreachable_huawei_services_are_never_reported_connected(monkeypatch):
    s = Settings(
        compute_provider="huawei_ecs", cache_provider="huawei_dcs", redis_url="redis://127.0.0.1:1/0", object_provider="huawei_obs",
        inference_provider="modelarts", modelarts_endpoint="http://127.0.0.1:1", modelarts_app_code="x",
    )
    monkeypatch.setattr(registry, "get_settings", lambda: s)
    for f in (registry.get_cache, registry.get_objects, registry.get_inference):
        f.cache_clear()
    monkeypatch.setattr(registry, "_last", None)
    monkeypatch.setattr(registry, "_probe_compute", lambda: httpx.get("http://127.0.0.1:1", timeout=1).text)
    try:
        status = registry.cloud_status(0)
        assert status["mode"] == "huawei_unreachable"
        assert {x["state"] for x in status["services"] if x["huawei"]} == {"error"}
    finally:
        for f in (registry.get_cache, registry.get_objects, registry.get_inference):
            f.cache_clear()
        registry._last = None


def test_default_mode_is_local(monkeypatch):
    monkeypatch.setattr(registry, "_last", None)
    status = registry.cloud_status(0)
    assert status["mode"] == "local" and all(x["state"] == "local" for x in status["services"])
    registry._last = None


@pytest.fixture
def container():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ml" / "modelarts"))
    import inference_server

    srv = ThreadingHTTPServer(("127.0.0.1", 0), inference_server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_modelarts_container_matches_local_inference(container):
    remote = ModelArtsInference(container, auth="none")
    assert "model sim-" in remote.probe()
    local = registry.get_inference().classifier
    assert remote.predict(FEATURES) == local.predict(FEATURES)
    with pytest.raises(httpx.HTTPStatusError):
        remote.predict({"log_ratio": 1})


def test_modelarts_iam_flow():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        if req.url.path == "/v3/auth/tokens":
            return httpx.Response(201, headers={"X-Subject-Token": "tok"})
        assert req.headers["X-Auth-Token"] == "tok"
        return httpx.Response(200, json={"label": "mild", "probabilities": {"mild": 1.0}, "confidence": 1.0, "model_version": "v", "training_origin": "simulated"})

    iam = {"endpoint": "https://iam.example", "domain": "d", "username": "u", "password": "p", "project": "r"}
    m = ModelArtsInference("https://ma.example/v1/infers/x", "iam", iam=iam, transport=httpx.MockTransport(handler))
    assert m.predict(FEATURES).label == "mild" and m.predict(FEATURES).label == "mild"
    assert [r.url.path for r in seen].count("/v3/auth/tokens") == 1
    assert json.loads(seen[0].content)["auth"]["scope"]["project"]["name"] == "r"


def test_production_refuses_development_secrets():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Settings(environment="production", secret_key=DEV_SECRET, demo_enabled=False).assert_safe()
    with pytest.raises(RuntimeError, match="DEMO"):
        Settings(environment="production", secret_key="x" * 40, demo_enabled=True).assert_safe()
    Settings(environment="production", secret_key="x" * 40, demo_enabled=False).assert_safe()
