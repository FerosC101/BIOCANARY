"""Trains, calibrates, evaluates and exports the inhibition classifier.

    python ml/train.py --data ml/data/simulated.csv --out ml/artifacts --backend mindspore

Runs locally or as a Huawei ModelArts training job (ModelArts passes --data_url / --train_url).
Splits are by station, so no station appears in more than one split. The exported JSON is plain
weights: the API and the ModelArts inference container both run it with numpy.
"""

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

CLASSES = ["normal", "mild", "moderate", "severe"]
META = {"group", "origin", "at", "latent", "label"}


def softmax(z: np.ndarray) -> np.ndarray:
    p = np.exp(z - z.max(1, keepdims=True))
    return p / p.sum(1, keepdims=True)


def forward(layers: list[tuple[np.ndarray, np.ndarray]], x: np.ndarray) -> np.ndarray:
    x = np.clip(x, -8, 8)
    for i, (w, b) in enumerate(layers):
        x = x @ w.T + b
        if i < len(layers) - 1:
            x = np.maximum(x, 0)
    return x


def nll(p: np.ndarray, y: np.ndarray) -> float:
    return float(-np.log(np.clip(p[np.arange(len(y)), y], 1e-9, 1)).mean())


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    conf, hit = p.max(1), p.argmax(1) == y
    total = 0.0
    for lo in np.linspace(0, 1, bins, endpoint=False):
        m = (conf > lo) & (conf <= lo + 1 / bins)
        if m.any():
            total += m.mean() * abs(hit[m].mean() - conf[m].mean())
    return float(total)


def train_mindspore(x, y, xv, yv, hidden, epochs, seed):
    import mindspore as ms
    from mindspore import nn

    ms.set_seed(seed)
    net = nn.SequentialCell(nn.Dense(x.shape[1], hidden), nn.ReLU(), nn.Dense(hidden, len(CLASSES)))
    loss_fn = nn.CrossEntropyLoss()
    opt = nn.Adam(net.trainable_params(), learning_rate=3e-3, weight_decay=1e-4)
    grad = ms.value_and_grad(lambda a, b: loss_fn(net(a), b), None, opt.parameters)
    rng, best, best_layers, stale = np.random.default_rng(seed), np.inf, None, 0

    def snapshot():
        return [(net[i].weight.asnumpy().astype(float).copy(), net[i].bias.asnumpy().astype(float).copy()) for i in (0, 2)]

    for epoch in range(epochs):
        net.set_train(True)
        for batch in np.array_split(rng.permutation(len(x)), max(1, len(x) // 128)):
            _, g = grad(ms.Tensor(x[batch].astype(np.float32)), ms.Tensor(y[batch].astype(np.int32)))
            opt(g)
        layers = snapshot()
        v = nll(softmax(forward(layers, xv)), yv)
        if v < best - 1e-4:
            best, best_layers, stale = v, layers, 0
        else:
            stale += 1
        if epoch % 10 == 0:
            print(f"epoch {epoch:3d}  validation nll {v:.4f}", flush=True)
        if stale >= 25:
            break
    return best_layers, f"MindSpore {ms.__version__}"


def train_sklearn(x, y, xv, yv, hidden, epochs, seed):
    import sklearn
    from sklearn.neural_network import MLPClassifier

    m = MLPClassifier((hidden,), alpha=1e-4, learning_rate_init=3e-3, max_iter=epochs, early_stopping=True, random_state=seed).fit(x, y)
    return [(w.T, b) for w, b in zip(m.coefs_, m.intercepts_, strict=True)], f"scikit-learn {sklearn.__version__}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", "--data_url", dest="data", default="ml/data/simulated.csv")
    ap.add_argument("--out", "--train_url", dest="out", default="ml/artifacts")
    ap.add_argument("--backend", choices=("mindspore", "sklearn"), default="mindspore")
    ap.add_argument("--hidden", type=int, default=16)
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--seed", type=int, default=7)
    a, _ = ap.parse_known_args()  # ModelArts adds its own arguments

    path = Path(a.data)
    if path.is_dir():
        path = sorted(path.glob("*.csv"))[0]
    raw = path.read_bytes()
    df = pd.read_csv(path)
    origins = set(df["origin"])
    if len(origins) != 1:
        raise SystemExit(f"Refusing to mix data origins in one model: {sorted(origins)}")
    origin = origins.pop()
    features = [c for c in df.columns if c not in META]

    groups = np.random.default_rng(a.seed).permutation(df["group"].unique())
    n = len(groups)
    split = {"train": groups[: int(n * 0.6)], "val": groups[int(n * 0.6) : int(n * 0.8)], "test": groups[int(n * 0.8) :]}
    part = {k: df[df["group"].isin(v)] for k, v in split.items()}
    X = {k: v[features].to_numpy(float) for k, v in part.items()}
    Y = {k: v["label"].map(CLASSES.index).to_numpy() for k, v in part.items()}
    mean, scale = X["train"].mean(0), X["train"].std(0).clip(1e-6)
    X = {k: (v - mean) / scale for k, v in X.items()}

    fit = train_mindspore if a.backend == "mindspore" else train_sklearn
    layers, framework = fit(X["train"], Y["train"], X["val"], Y["val"], a.hidden, a.epochs, a.seed)

    # Temperature scaling on the validation split only.
    zv, zt = forward(layers, X["val"]), forward(layers, X["test"])
    temperature = float(minimize_scalar(lambda t: nll(softmax(zv / t), Y["val"]), bounds=(0.2, 5), method="bounded").x)
    p_raw, p = softmax(zt), softmax(zt / temperature)
    y, pred = Y["test"], p.argmax(1)
    confusion = [[int(((y == i) & (pred == j)).sum()) for j in range(4)] for i in range(4)]
    per_class = {}
    for i, c in enumerate(CLASSES):
        tp = confusion[i][i]
        prec, rec = tp / max(1, sum(r[i] for r in confusion)), tp / max(1, sum(confusion[i]))
        per_class[c] = {"precision": round(prec, 4), "recall": round(rec, 4), "f1": round(2 * prec * rec / max(1e-9, prec + rec), 4), "support": int((y == i).sum())}
    adjacent = float((np.abs(y - pred) <= 1).mean())
    calibrated_ece = ece(p, y)

    now = datetime.now(UTC)
    artifact = {
        "version": f"{origin[:3]}-{now:%Y%m%d}-{hashlib.sha256(raw).hexdigest()[:6]}",
        "created_at": now.isoformat(),
        "framework": framework,
        "architecture": f"MLP {len(features)}-{a.hidden}-{len(CLASSES)}, ReLU",
        "training_origin": origin,
        "dataset": {
            "sha256": hashlib.sha256(raw).hexdigest(), "rows": len(df), "stations": int(n),
            "split": {k: {"stations": len(split[k]), "rows": len(part[k])} for k in split},
        },
        "classes": CLASSES,
        "features": features,
        "scaler": {"mean": mean.tolist(), "scale": scale.tolist()},
        "layers": [{"weight": np.round(w, 8).tolist(), "bias": np.round(b, 8).tolist()} for w, b in layers],
        "calibration": {
            "method": "temperature scaling", "temperature": temperature, "ece_before": round(ece(p_raw, y), 4),
            "ece_after": round(calibrated_ece, 4), "calibrated": calibrated_ece <= 0.05,
        },
        "metrics": {
            "evaluated_on": f"held-out {origin} stations", "accuracy": round(float((pred == y).mean()), 4),
            "macro_f1": round(float(np.mean([v["f1"] for v in per_class.values()])), 4),
            "within_one_class": round(adjacent, 4), "per_class": per_class, "confusion": confusion,
        },
        "limitations": (
            "Trained and evaluated on simulated data only. These metrics describe agreement with the simulator and say "
            "nothing about performance on real microorganisms or wastewater."
            if origin == "simulated" else "See the dataset documentation for the experimental scope."
        ),
    }
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "inhibition_classifier.json").write_text(json.dumps(artifact, indent=1))
    print(json.dumps({k: artifact[k] for k in ("version", "framework", "dataset", "calibration", "metrics")}, indent=1))


if __name__ == "__main__":
    main()
