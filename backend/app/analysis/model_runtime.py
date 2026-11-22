"""Dependency-light inference for the exported classifier (used by the API and the ModelArts container)."""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class Prediction:
    label: str
    probabilities: dict[str, float]
    confidence: float | None  # only set when the model's probabilities were calibrated
    model_version: str
    training_origin: str  # simulated | experimental

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Prediction":
        return cls(**{k: d[k] for k in ("label", "probabilities", "confidence", "model_version", "training_origin")})


class Classifier:
    def __init__(self, artifact: dict[str, Any]) -> None:
        self.artifact = artifact
        self.version: str = artifact["version"]
        self.classes: list[str] = artifact["classes"]
        self.features: list[str] = artifact["features"]
        self.training_origin: str = artifact["training_origin"]
        self.calibrated: bool = bool(artifact["calibration"]["calibrated"])
        self._temperature = float(artifact["calibration"]["temperature"])
        self._mean = np.asarray(artifact["scaler"]["mean"])
        self._scale = np.asarray(artifact["scaler"]["scale"])
        self._layers = [(np.asarray(x["weight"]), np.asarray(x["bias"])) for x in artifact["layers"]]

    def predict(self, features: dict[str, float]) -> Prediction:
        x = (np.array([features[f] for f in self.features], dtype=float) - self._mean) / self._scale
        # Outside the range seen in training a softmax is still "confident"; bound the inputs.
        x = np.clip(x, -8, 8)
        for i, (w, b) in enumerate(self._layers):
            x = w @ x + b
            if i < len(self._layers) - 1:
                x = np.maximum(x, 0)
        logits = x / self._temperature
        p = np.exp(logits - logits.max())
        p /= p.sum()
        best = int(p.argmax())
        return Prediction(
            self.classes[best],
            {c: round(float(v), 4) for c, v in zip(self.classes, p, strict=True)},
            round(float(p[best]), 4) if self.calibrated else None,
            self.version,
            self.training_origin,
        )


def load_classifier(path: str) -> Classifier | None:
    p = Path(path)
    return Classifier(json.loads(p.read_text())) if p.exists() else None
