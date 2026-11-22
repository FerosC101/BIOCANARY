"""Builds the configured adapters and reports what is *actually* reachable.

A Huawei Cloud service is reported as connected only after a live probe succeeds. Selecting a
provider in configuration is never enough.
"""

import time
from dataclasses import asdict, dataclass
from functools import lru_cache

import httpx
from sqlalchemy import text

from ..analysis.model_runtime import load_classifier
from ..config import Settings, get_settings
from .cache import Cache, MemoryCache, RedisCache
from .inference import Inference, LocalInference, ModelArtsInference
from .objects import FilesystemStore, ObjectStore, ObsStore


@dataclass
class ServiceStatus:
    key: str
    name: str
    responsibility: str
    provider: str
    huawei: bool  # a Huawei Cloud provider is selected for this service
    state: str  # connected | local | error
    detail: str
    latency_ms: int | None = None


@lru_cache
def get_cache() -> Cache:
    s = get_settings()
    if s.cache_provider == "memory":
        return MemoryCache()
    if not s.redis_url:
        raise ValueError("BIOCANARY_REDIS_URL is required for the Redis cache provider")
    return RedisCache(s.redis_url, s.cache_provider)


@lru_cache
def get_objects() -> ObjectStore:
    s = get_settings()
    if s.object_provider == "filesystem":
        return FilesystemStore(s.object_dir)
    return ObsStore(s.obs_endpoint, s.obs_bucket, s.obs_access_key, s.obs_secret_key)


@lru_cache
def get_inference() -> Inference:
    s = get_settings()
    if s.inference_provider == "local":
        return LocalInference(load_classifier(s.model_path))
    return ModelArtsInference(
        s.modelarts_endpoint,
        s.modelarts_auth,
        s.modelarts_app_code,
        {
            "endpoint": s.iam_endpoint,
            "domain": s.iam_domain,
            "username": s.iam_username,
            "password": s.iam_password,
            "project": s.iam_project,
        },
        s.modelarts_timeout_seconds,
    )


def _probe_database() -> str:
    from ..db import engine

    with engine.connect() as conn:
        if engine.dialect.name == "postgresql":
            return "PostgreSQL " + conn.execute(text("show server_version")).scalar_one().split()[0]
        conn.execute(text("select 1"))
        return engine.dialect.name.capitalize()


def _probe_compute() -> str:
    """ECS instances expose the OpenStack metadata service on a link-local address."""
    if get_settings().compute_provider == "local":
        return "Local process"
    resp = httpx.get("http://169.254.169.254/openstack/latest/meta_data.json", timeout=2)
    resp.raise_for_status()
    meta = resp.json()
    return f"ECS instance in {meta.get('availability_zone', 'unknown zone')}"


def _run(key, name, responsibility, provider, huawei, probe) -> ServiceStatus:
    started = time.perf_counter()
    try:
        detail = probe()
        state = "connected" if huawei else "local"
    except Exception as exc:  # a failed probe is a result, not a crash
        detail, state = f"{type(exc).__name__}: {str(exc)[:160]}", "error"
    return ServiceStatus(
        key, name, responsibility, provider, huawei, state, detail, round((time.perf_counter() - started) * 1000)
    )


def probe_services(settings: Settings | None = None) -> list[ServiceStatus]:
    s = settings or get_settings()
    return [
        _run("compute", "ECS", "Application and API host", s.compute_provider, s.compute_provider == "huawei_ecs", _probe_compute),
        _run("database", "RDS", "Measurements, assessments and alerts", s.database_provider, s.database_provider == "huawei_rds", _probe_database),
        _run("cache", "Redis (DCS)", "Latest readings and live state", s.cache_provider, s.cache_provider == "huawei_dcs", lambda: get_cache().probe()),
        _run("objects", "OBS", "Raw datasets and generated reports", s.object_provider, s.object_provider == "huawei_obs", lambda: get_objects().probe()),
        _run("inference", "ModelArts", "Model inference", s.inference_provider, s.inference_provider == "modelarts", lambda: get_inference().probe()),
    ]


_last: tuple[float, list[ServiceStatus]] | None = None


def cloud_status(max_age: float = 30) -> dict:
    global _last
    if _last is None or time.monotonic() - _last[0] > max_age:
        _last = (time.monotonic(), probe_services())
    services = _last[1]
    selected = [x for x in services if x.huawei]
    connected = [x for x in selected if x.state == "connected"]
    if not selected:
        mode, label = "local", "Local development"
    elif len(connected) == len(services):
        mode, label = "huawei_connected", "Huawei Cloud connected"
    elif connected:
        mode, label = "huawei_partial", f"Huawei Cloud: {len(connected)} of {len(services)} services"
    else:
        mode, label = "huawei_unreachable", "Huawei Cloud configured, not connected"
    return {"mode": mode, "label": label, "services": [asdict(x) for x in services]}
