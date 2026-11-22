"""Model inference: in-process locally, a Huawei ModelArts real-time service in production.

Both run the same exported artifact, so a ModelArts deployment returns the same probabilities as
local inference. When ModelArts is selected and unreachable the call fails visibly; it never falls
back silently, because the assessment records which backend produced the result.
"""

import threading
import time
from typing import Protocol

import httpx

from ..analysis.model_runtime import Classifier, Prediction


class Inference(Protocol):
    provider: str

    def predict(self, features: dict[str, float]) -> Prediction | None: ...
    def probe(self) -> str: ...


class LocalInference:
    provider = "local"

    def __init__(self, classifier: Classifier | None) -> None:
        self.classifier = classifier

    def predict(self, features):
        return self.classifier.predict(features) if self.classifier else None

    def probe(self):
        return f"In-process model {self.classifier.version}" if self.classifier else "No model artifact"


class ModelArtsInference:
    provider = "modelarts"

    def __init__(
        self,
        endpoint: str,
        auth: str = "appcode",
        app_code: str = "",
        iam: dict[str, str] | None = None,
        timeout: float = 8.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not endpoint:
            raise ValueError("ModelArts is not configured: missing endpoint")
        if auth == "appcode" and not app_code:
            raise ValueError("ModelArts is not configured: missing AppCode")
        if auth == "iam" and not all((iam or {}).get(k) for k in ("endpoint", "domain", "username", "password", "project")):
            raise ValueError("ModelArts is not configured: incomplete IAM credentials")
        self.endpoint, self.auth, self.app_code, self.iam = endpoint.rstrip("/"), auth, app_code, iam or {}
        self._http = httpx.Client(timeout=timeout, transport=transport)
        self._token: tuple[float, str] | None = None
        self._mutex = threading.Lock()

    def _headers(self) -> dict[str, str]:
        if self.auth == "appcode":
            return {"X-Apig-AppCode": self.app_code}
        if self.auth == "iam":
            return {"X-Auth-Token": self._iam_token()}
        return {}

    def _iam_token(self) -> str:
        with self._mutex:
            if self._token and self._token[0] > time.monotonic():
                return self._token[1]
            body = {
                "auth": {
                    "identity": {
                        "methods": ["password"],
                        "password": {
                            "user": {
                                "name": self.iam["username"],
                                "password": self.iam["password"],
                                "domain": {"name": self.iam["domain"]},
                            }
                        },
                    },
                    "scope": {"project": {"name": self.iam["project"]}},
                }
            }
            resp = self._http.post(self.iam["endpoint"].rstrip("/") + "/v3/auth/tokens", json=body)
            resp.raise_for_status()
            token = resp.headers["X-Subject-Token"]
            self._token = (time.monotonic() + 20 * 3600, token)  # IAM tokens last 24 h
            return token

    def predict(self, features):
        resp = self._http.post(self.endpoint + "/infer", json={"features": features}, headers=self._headers())
        resp.raise_for_status()
        return Prediction.from_dict(resp.json())

    def probe(self):
        resp = self._http.get(self.endpoint + "/health", headers=self._headers())
        resp.raise_for_status()
        return f"ModelArts service, model {resp.json().get('model_version', 'unknown')}"
