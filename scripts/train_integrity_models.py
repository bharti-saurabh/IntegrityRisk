"""Train the supervised component of the integrity ensemble + report metrics.

Offline analogue of the in-browser supervised scorer. Fits a gradient-boosted
classifier on the engineered features against the ground-truth abuse flag, then
reports precision/recall/F1/ROC-AUC/PR-AUC and a threshold sweep so you can see
the same precision-vs-recall tradeoff the Impact Simulator exposes in the UI.

Ground truth is used ONLY for evaluation and to fit the supervised head — the
composite ensemble in the browser blends this with rules, anomaly, graph,
descriptor-NLP, MCC-mismatch, and behavioral-change components.

Deterministic from config.SEED. Writes scripts/artifacts/integrity_model.json.

Usage:  python3 scripts/train_integrity_models.py
"""
from __future__ import annotations

import json

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    average_precision_score, precision_recall_fscore_support, roc_auc_score,
)
from sklearn.model_selection import train_test_split

from config import SEED, ARTIFACT_DIR, DEFAULT_OPERATING_THRESHOLD
from artifacts_io import load

FEATURES = ["txn_count", "avg_ticket", "std_ticket", "cash_share",
            "card_present_share", "refund_rate", "threshold_proximity"]


def sweep(y_true: np.ndarray, scores: np.ndarray) -> list[dict]:
    pts = []
    for t in range(0, 101, 2):
        pred = scores >= (t / 100.0)
        p, r, f1, _ = precision_recall_fscore_support(
            y_true, pred, average="binary", zero_division=0
        )
        pts.append({"threshold": t, "precision": round(float(p), 4),
                    "recall": round(float(r), 4), "f1": round(float(f1), 4),
                    "alerts": int(pred.sum())})
    return pts


def main() -> None:
    feat = load("features")
    X = feat[FEATURES].fillna(0).to_numpy()
    y = feat["ground_truth_abuse"].to_numpy().astype(int)

    Xtr, Xte, ytr, yte = train_test_split(
        X, y, test_size=0.3, random_state=SEED, stratify=y
    )
    clf = GradientBoostingClassifier(random_state=SEED)
    clf.fit(Xtr, ytr)

    scores = clf.predict_proba(Xte)[:, 1]
    op = DEFAULT_OPERATING_THRESHOLD / 100.0
    pred = scores >= op
    p, r, f1, _ = precision_recall_fscore_support(
        yte, pred, average="binary", zero_division=0
    )
    roc = roc_auc_score(yte, scores)
    pr = average_precision_score(yte, scores)

    print(f"[integrity] test n={len(yte):,}  positives={yte.sum():,}")
    print(f"[integrity] @threshold {DEFAULT_OPERATING_THRESHOLD}: "
          f"precision={p:.3f} recall={r:.3f} f1={f1:.3f}")
    print(f"[integrity] ROC-AUC={roc:.3f}  PR-AUC={pr:.3f}")

    importance = sorted(
        ({"feature": f, "importance": round(float(imp), 4)}
         for f, imp in zip(FEATURES, clf.feature_importances_)),
        key=lambda d: -d["importance"],
    )
    print("[integrity] feature importance:",
          ", ".join(f"{d['feature']}={d['importance']}" for d in importance))

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "seed": SEED,
        "features": FEATURES,
        "operating_threshold": DEFAULT_OPERATING_THRESHOLD,
        "metrics": {
            "precision": round(float(p), 4),
            "recall": round(float(r), 4),
            "f1": round(float(f1), 4),
            "roc_auc": round(float(roc), 4),
            "pr_auc": round(float(pr), 4),
        },
        "feature_importance": importance,
        "threshold_sweep": sweep(yte, scores),
    }
    (ARTIFACT_DIR / "integrity_model.json").write_text(json.dumps(out, indent=2))
    print(f"[integrity] wrote {ARTIFACT_DIR / 'integrity_model.json'}")


if __name__ == "__main__":
    main()
