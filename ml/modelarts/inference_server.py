"""Inference container for a Huawei ModelArts real-time service (custom image, HTTP port 8080)."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, os.environ.get("BIOCANARY_RUNTIME", str(Path(__file__).resolve().parents[2] / "backend")))
from app.analysis.model_runtime import load_classifier  # noqa: E402

MODEL_PATH = os.environ.get("MODEL_PATH", str(Path(__file__).resolve().parents[1] / "artifacts" / "inhibition_classifier.json"))
classifier = load_classifier(MODEL_PATH)
if classifier is None:
    raise SystemExit(f"Model artifact not found: {MODEL_PATH}")


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path.split("?")[0] == "/health":
            self._send(200, {"health": "true", "model_version": classifier.version, "training_origin": classifier.training_origin})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/infer":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > 65536:
                return self._send(413, {"error": "payload too large"})
            features = json.loads(self.rfile.read(length))["features"]
            self._send(200, classifier.predict({k: float(v) for k, v in features.items()}).to_dict())
        except (KeyError, TypeError, ValueError) as exc:
            self._send(400, {"error": f"invalid request: {exc}"})

    def log_message(self, *_) -> None:
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"model {classifier.version} on :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
