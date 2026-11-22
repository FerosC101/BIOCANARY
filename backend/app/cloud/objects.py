"""Object storage: local filesystem in development, Huawei Cloud OBS in production."""

from pathlib import Path
from typing import Protocol


class ObjectStore(Protocol):
    provider: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def probe(self) -> str: ...


class FilesystemStore:
    provider = "filesystem"

    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("object key escapes the storage directory")
        return path

    def put(self, key, data, content_type):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key):
        return self._path(key).read_bytes()

    def probe(self):
        self.root.mkdir(parents=True, exist_ok=True)
        return "Local directory"


class ObsStore:
    provider = "huawei_obs"

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, client=None) -> None:
        missing = [n for n, v in (("endpoint", endpoint), ("bucket", bucket)) if not v]
        if client is None:
            missing += [n for n, v in (("access key", access_key), ("secret key", secret_key)) if not v]
        if missing:
            raise ValueError("OBS is not configured: missing " + ", ".join(missing))
        if client is None:
            from obs import ObsClient

            client = ObsClient(
                access_key_id=access_key, secret_access_key=secret_key, server=endpoint, timeout=10, max_retry_count=1
            )
        self._client, self.bucket = client, bucket

    @staticmethod
    def _check(resp, action: str):
        if resp.status >= 300:
            raise RuntimeError(f"OBS {action} failed: HTTP {resp.status} {resp.errorCode or ''}".strip())
        return resp

    def put(self, key, data, content_type):
        self._check(
            self._client.putContent(self.bucket, key, content=data, metadata={"content-type": content_type}), "upload"
        )

    def get(self, key):
        resp = self._check(self._client.getObject(self.bucket, key, loadStreamInMemory=True), "download")
        return resp.body.buffer

    def probe(self):
        self._check(self._client.headBucket(self.bucket), "bucket check")
        return f"Bucket {self.bucket}"
