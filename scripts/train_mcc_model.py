"""Train the MCC classifier — predict the category the behavior actually resembles.

Offline analogue of the in-browser nearest-behavioral-profile model. Here we fit
a multinomial classifier on behavioral features with the *behavior* MCC as the
label, then measure how often the declared MCC disagrees with the prediction
(the mismatch signal that drives the flagship MCC Miscoding Studio).

Deterministic from config.SEED. Writes scripts/artifacts/mcc_model.json.

Usage:  python3 scripts/train_mcc_model.py
"""
from __future__ import annotations

import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, top_k_accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from config import SEED, ARTIFACT_DIR, MCC_PROFILES
from artifacts_io import load

FEATURES = ["avg_ticket", "std_ticket", "cash_share",
            "card_present_share", "refund_rate", "threshold_proximity"]


def main() -> None:
    feat = load("features").dropna(subset=["behavior_mcc"])
    X = feat[FEATURES].to_numpy()
    y = feat["behavior_mcc"].to_numpy()

    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)

    Xtr, Xte, ytr, yte = train_test_split(
        Xs, y, test_size=0.25, random_state=SEED, stratify=y
    )
    clf = LogisticRegression(max_iter=2000, random_state=SEED)
    clf.fit(Xtr, ytr)

    pred = clf.predict(Xte)
    acc = accuracy_score(yte, pred)
    proba = clf.predict_proba(Xte)
    top3 = top_k_accuracy_score(yte, proba, k=3, labels=clf.classes_)

    # Mismatch analysis over the full portfolio: declared vs predicted behavior MCC.
    all_pred = clf.predict(Xs)
    declared = feat["declared_mcc"].to_numpy()
    mismatch = all_pred != declared
    abusive = feat["ground_truth_abuse"].to_numpy().astype(bool)

    mismatch_recall = mismatch[abusive].mean() if abusive.any() else 0.0
    mismatch_fpr = mismatch[~abusive].mean() if (~abusive).any() else 0.0

    print(f"[mcc] classes: {list(clf.classes_)}")
    print(f"[mcc] top-1 accuracy: {acc:.3f}   top-3 accuracy: {top3:.3f}")
    print(f"[mcc] declared!=predicted on {mismatch.mean():.1%} of merchants")
    print(f"[mcc] mismatch flags {mismatch_recall:.1%} of true-abuse merchants "
          f"(vs {mismatch_fpr:.1%} of clean)")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "seed": SEED,
        "features": FEATURES,
        "classes": list(clf.classes_),
        "labels": {c: MCC_PROFILES[c]["label"] for c in clf.classes_},
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "coef": clf.coef_.tolist(),
        "intercept": clf.intercept_.tolist(),
        "metrics": {
            "top1_accuracy": round(float(acc), 4),
            "top3_accuracy": round(float(top3), 4),
            "mismatch_rate": round(float(mismatch.mean()), 4),
            "mismatch_recall_on_abuse": round(float(mismatch_recall), 4),
            "mismatch_fpr_on_clean": round(float(mismatch_fpr), 4),
        },
    }
    (ARTIFACT_DIR / "mcc_model.json").write_text(json.dumps(out, indent=2))
    print(f"[mcc] wrote {ARTIFACT_DIR / 'mcc_model.json'}")


if __name__ == "__main__":
    main()
