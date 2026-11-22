"""Live-state cache and event fan-out: in-process locally, Huawei Cloud DCS (Redis) in production."""

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator
from typing import Any, Protocol

CHANNEL = "biocanary:events"


class Cache(Protocol):
    provider: str

    def get(self, key: str) -> Any | None: ...
    def set(self, key: str, value: Any, ttl: int | None = None) -> None: ...
    def delete(self, key: str) -> None: ...
    def incr(self, key: str, ttl: int) -> int: ...
    def lock(self, key: str, ttl: int) -> bool: ...
    def publish(self, event: dict[str, Any]) -> None: ...
    def subscribe(self) -> AsyncIterator[dict[str, Any] | None]: ...
    def probe(self) -> str: ...


class MemoryCache:
    provider = "memory"

    def __init__(self) -> None:
        self._data: dict[str, tuple[float | None, str]] = {}
        self._mutex = threading.RLock()
        self._subs: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()

    def _live(self, key: str) -> str | None:
        item = self._data.get(key)
        if item is None:
            return None
        if item[0] is not None and item[0] < time.monotonic():
            del self._data[key]
            return None
        return item[1]

    def get(self, key):
        with self._mutex:
            raw = self._live(key)
        return None if raw is None else json.loads(raw)

    def set(self, key, value, ttl=None):
        with self._mutex:
            self._data[key] = (time.monotonic() + ttl if ttl else None, json.dumps(value, default=str))

    def delete(self, key):
        with self._mutex:
            self._data.pop(key, None)

    def incr(self, key, ttl):
        with self._mutex:
            raw = self._live(key)
            count = int(raw) + 1 if raw else 1
            expiry = self._data[key][0] if raw else time.monotonic() + ttl
            self._data[key] = (expiry, str(count))
            return count

    def lock(self, key, ttl):
        with self._mutex:
            if self._live(key) is not None:
                return False
            self._data[key] = (time.monotonic() + ttl, "1")
            return True

    def publish(self, event):
        with self._mutex:
            subs = list(self._subs)
        for loop, queue in subs:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:  # loop already closed
                with self._mutex:
                    self._subs.discard((loop, queue))

    async def subscribe(self):
        entry = (asyncio.get_running_loop(), asyncio.Queue())
        with self._mutex:
            self._subs.add(entry)
        try:
            while True:
                try:
                    yield await asyncio.wait_for(entry[1].get(), timeout=15)
                except TimeoutError:
                    yield None  # heartbeat
        finally:
            with self._mutex:
                self._subs.discard(entry)

    def probe(self):
        return "In-process cache"


class RedisCache:
    """Redis protocol client. Used for both a self-managed Redis and Huawei Cloud DCS."""

    def __init__(self, url: str, provider: str, client=None, async_client_factory=None) -> None:
        import redis
        import redis.asyncio as aioredis

        self.provider = provider
        self._r = client or redis.Redis.from_url(url, decode_responses=True, socket_timeout=3, socket_connect_timeout=3)
        self._async = async_client_factory or (lambda: aioredis.Redis.from_url(url, decode_responses=True))

    def get(self, key):
        raw = self._r.get(key)
        return None if raw is None else json.loads(raw)

    def set(self, key, value, ttl=None):
        self._r.set(key, json.dumps(value, default=str), ex=ttl)

    def delete(self, key):
        self._r.delete(key)

    def incr(self, key, ttl):
        with self._r.pipeline() as pipe:
            pipe.set(key, 0, ex=ttl, nx=True)  # starts the window; keeps the expiry of a running one
            pipe.incr(key)
            return int(pipe.execute()[1])

    def lock(self, key, ttl):
        return bool(self._r.set(key, "1", ex=ttl, nx=True))

    def publish(self, event):
        self._r.publish(CHANNEL, json.dumps(event, default=str))

    async def subscribe(self):
        client = self._async()
        pubsub = client.pubsub()
        try:
            await pubsub.subscribe(CHANNEL)
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                yield json.loads(msg["data"]) if msg else None
        finally:
            await pubsub.aclose()
            await client.aclose()

    def probe(self):
        self._r.ping()
        info = self._r.info("server")
        return f"Redis {info.get('redis_version', 'unknown version')}"
