#!/usr/bin/env python3
"""
build_model_registry.py
-----------------------
Emits the compact JSON that backs the Model Store page. Every model in the store is
a *real* scorer from the detection pipeline — the same peer-normalized logistic
feature groups the merchant table is scored with (build_merchant_aggregate.py). We
do not invent architectures: we surface the actual feature weights, the calibration,
the paired deterministic rules, and per-model precision/recall measured against the
planted ground-truth labels.

Model classes in the store:
  * 6 method / family detectors   (PATTERN_WEIGHTS)  → one flagship per family
  * 1 composite ensemble          (OVERALL_WEIGHTS)  → the portfolio risk score
  * 11 content sub-classifiers     (CATEGORY_WEIGHTS) → MCC-miscoding P1/P2/P3 bank
  * 1 expert-rule pack             (9 deterministic rules)

Usage
    python build_model_registry.py \
        --data "../MCC Miscoding Data v2/data" \
        --out  "../src/data/models.generated.json"
"""

import argparse
import json
import os

import numpy as np
import pandas as pd

from build_merchant_aggregate import (
    CATEGORY_WEIGHTS, PATTERN_WEIGHTS, OVERALL_WEIGHTS,
)
from build_web_artifacts import (
    primary_family, CATEGORY_TIER, CATEGORY_LABEL, FAMILY_LABEL,
)

LOGISTIC_K = 1.35          # per-model score steepness (build_merchant_aggregate.score)
COMPOSITE_K = 1.55         # integrity_risk_score steepness

# ---- human-readable feature glossary ---------------------------------------
# Each pipeline feature is a peer z-score (deviation from the same-MCC cohort).
FEATURE_LABEL = {
    "z_pct_night_txn": "Night-hour transaction share",
    "z_pct_round_amount": "Round-amount share",
    "z_txn_per_card": "Transactions per card",
    "z_pct_cnp": "Card-not-present share",
    "z_pct_cross_border": "Cross-border share",
    "z_pct_decline_not_permitted": "‘Transaction not permitted’ decline rate",
    "z_pct_offshore_acquirer": "Offshore-acquirer share",
    "z_ticket_vs_mcc_expected": "Ticket size vs MCC-expected",
    "z_max_txn_single_card": "Largest single-card volume",
    "z_pct_quasi_cash": "Quasi-cash share",
    "z_hour_entropy": "Hour-of-day entropy",
    "z_pct_recurring": "Recurring / negative-option share",
    "z_chargeback_rate_bps": "Chargeback rate (bps)",
    "z_refund_rate_count": "Refund rate",
    "z_descriptor_changes": "Descriptor-change count",
    "z_pct_ticket_lt_20": "Micro-ticket (<$20) share",
    "z_descriptor_name_jaccard": "Descriptor / DBA name similarity",
    "z_pct_cb_service_reason": "‘Service not rendered’ chargeback share",
    "z_issuer_country_entropy": "Issuer-country entropy",
    "z_pct_generic_descriptor": "Generic-descriptor share",
    "z_pct_round_100": "Round-$100 share",
    "z_avg_ticket_usd": "Average ticket (USD)",
    "z_pct_decline_limit": "‘Exceeds limit’ decline rate",
    "z_pct_ticket_gt_500": "High-ticket (>$500) share",
    "z_distinct_amount_ratio": "Distinct-amount ratio",
    "z_decline_rate": "Overall decline rate",
    "z_cnp_vs_mcc_expected": "CNP share vs MCC-expected",
    "z_pct_keyed": "Keyed-entry share",
    "z_pct_moto": "MOTO share",
    "z_pct_txn_in_split_burst": "Share of txns inside a split burst",
    "z_split_burst_events": "Split-burst event count",
    "z_pct_near_ceiling": "Near-authorization-ceiling share",
    "z_mean_split_burst_size": "Mean split-burst size",
    "z_pct_cards_multi_use": "Multi-use-card share",
    "z_mean_split_gap_sec": "Mean gap between split legs (sec)",
    "z_n_sub_merchant_ids": "Distinct sub-merchant IDs",
    "z_volume_spike_ratio": "Volume-spike ratio",
    "z_max_mom_growth": "Peak month-over-month growth",
    "z_n_distinct_descriptors": "Distinct descriptors",
    "z_ticket_cv": "Ticket coefficient of variation",
    "z_has_url_descriptor": "URL-in-descriptor flag",
    "z_interchange_advantage_bps": "Interchange advantage (bps)",
    "z_declared_band_is_cheap": "Declared cheap-interchange band",
    "z_pct_token": "Tokenized-credential share",
    "z_effective_interchange_bps": "Effective interchange paid (bps)",
    "z_night_vs_mcc_expected": "Night share vs MCC-expected",
    "z_pct_decline_suspected_fraud": "‘Suspected fraud’ decline rate",
}


def flabel(key):
    return FEATURE_LABEL.get(key, key.replace("z_", "").replace("_", " "))


def features_from(weights):
    """Normalize a weight dict into ranked feature-importance entries."""
    total = sum(abs(v) for v in weights.values()) or 1.0
    feats = [
        {
            "key": k,
            "label": flabel(k),
            "weight": round(float(w), 3),
            "importance": round(abs(w) / total * 100, 1),
            "direction": "up" if w >= 0 else "down",
        }
        for k, w in weights.items()
    ]
    return sorted(feats, key=lambda d: -abs(d["weight"]))


def binary_metrics(pred, actual):
    pred = pred.astype(bool).values
    actual = actual.astype(bool).values
    tp = int((pred & actual).sum())
    fp = int((pred & ~actual).sum())
    fn = int((~pred & actual).sum())
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    return {
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "tp": tp, "fp": fp, "fn": fn,
        "support": int(actual.sum()),
    }


def auc(score, actual):
    """Threshold-free score discrimination (Mann-Whitney / rank AUC). No sklearn."""
    score = pd.to_numeric(score, errors="coerce").fillna(0.0).values
    actual = actual.astype(bool).values
    n_pos = int(actual.sum())
    n_neg = int((~actual).sum())
    if n_pos == 0 or n_neg == 0:
        return None
    order = np.argsort(score, kind="mergesort")
    ranks = np.empty(len(score), dtype=float)
    ranks[order] = np.arange(1, len(score) + 1)
    # average ranks for ties
    s_sorted = score[order]
    i = 0
    while i < len(s_sorted):
        j = i
        while j + 1 < len(s_sorted) and s_sorted[j + 1] == s_sorted[i]:
            j += 1
        if j > i:
            avg = (ranks[order[i]] + ranks[order[j]]) / 2.0
            for k in range(i, j + 1):
                ranks[order[k]] = avg
        i = j + 1
    sum_pos = ranks[actual].sum()
    return round((sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg), 3)


# archetype (ground truth) → detection family
ARCH_FAMILY = {
    "mcc_abuse_interchange": "mcc_abuse",
    "split_ticketing": "split_ticketing",
    "factoring_host": "factoring",
    "cash_disbursement": "cash",
}


# ---- model registry ---------------------------------------------------------
# One entry per flagship family / method detector. `positive` names the boolean
# ground-truth column used to score it. `rules` are the paired deterministic gates.
METHOD_MODELS = [
    {
        "id": "det-mcc-miscoding", "family": "mcc_miscoding", "weights_key": "mcc_miscoding",
        "name": "MCC Miscoding Detector", "version": "2.3.0", "status": "production",
        "summary": "Declared MCC vs. observed acceptance behaviour. Fires when a merchant's "
                   "channel, timing and ticket profile do not match the category it settles under.",
        "detects": "Merchants coded into a benign MCC while transacting like a prohibited "
                   "or restricted vertical.",
        "output": "score_mcc_miscoding",
        "rules": [],
    },
    {
        "id": "det-split-ticketing", "family": "split_ticketing", "weights_key": "split_ticketing",
        "name": "Split-Ticket Burst Detector", "version": "1.9.0", "status": "production",
        "summary": "Bursts of near-identical, near-ceiling authorizations on the same card within "
                   "a short window — one sale sliced under the floor limit.",
        "detects": "Ticket splitting to stay below authorization or review ceilings.",
        "output": "score_split_ticketing",
        "rules": ["split_ticketing_rule"],
    },
    {
        "id": "det-factoring", "family": "factoring", "weights_key": "factoring",
        "name": "Factoring / Aggregation Detector", "version": "1.6.0", "status": "production",
        "summary": "One acquiring shell settling for many undisclosed sub-merchants — sub-merchant "
                   "fan-out, descriptor sprawl and volume spikes with low name coherence.",
        "detects": "Transaction laundering: a host processing third-party volume it never underwrote.",
        "output": "score_factoring",
        "rules": ["factoring_rule"],
    },
    {
        "id": "det-descriptor", "family": "descriptor", "weights_key": "descriptor",
        "name": "Descriptor Intelligence", "version": "1.4.0", "status": "production",
        "summary": "Churning, generic or URL-laden billing descriptors that drift away from the "
                   "registered DBA name — a concealment tell independent of content.",
        "detects": "Descriptor manipulation used to evade name-match monitoring and cardholder recognition.",
        "output": "score_descriptor",
        "rules": ["descriptor_churn_rule"],
    },
    {
        "id": "det-mcc-abuse", "family": "mcc_abuse", "weights_key": "mcc_abuse",
        "name": "Interchange-Abuse Detector", "version": "2.1.0", "status": "production",
        "summary": "A large positive interchange advantage sitting on a card-not-present profile "
                   "inside a category that should be card-present (grocery / fuel / charity).",
        "detects": "MCC chosen for a cheaper interchange band than the behaviour warrants — a "
                   "revenue-integrity class, not a prohibited-content class.",
        "output": "score_mcc_abuse",
        "rules": ["interchange_abuse_rule"],
    },
    {
        "id": "det-cash", "family": "cash", "weights_key": "cash_disbursement",
        "name": "Cash-Disbursement Detector", "version": "1.5.0", "status": "production",
        "summary": "Very round, high-ticket, repeat-card draws against a merchant whose declared "
                   "category is not a permitted cash outlet.",
        "detects": "Quasi-cash extraction / factoring-for-cash outside licensed cash MCCs.",
        "output": "score_cash_disbursement",
        "rules": ["cash_disbursement_rule", "undeclared_quasi_cash_rule"],
    },
]

# deterministic rule pack (mirrors build_merchant_aggregate.score, r1..r9)
RULE_PACK = [
    ("split_ticketing_rule", "split_ticketing",
     "pct_txn_in_split_burst > 0.10  AND  pct_near_ceiling > 0.15"),
    ("factoring_rule", "factoring",
     "n_sub_merchant_ids ≥ 2  AND  volume_spike_ratio > 3"),
    ("descriptor_churn_rule", "descriptor",
     "descriptor_changes ≥ 3  AND  descriptor_name_jaccard < 0.20"),
    ("undeclared_quasi_cash_rule", "cash",
     "pct_quasi_cash > 0.25  AND  MCC not in cash bands"),
    ("gambling_behaviour_rule", "mcc_miscoding",
     "pct_night_txn > 0.35  AND  pct_round_amount > 0.30  AND  pct_cross_border > 0.30"),
    ("dispute_excursion_rule", "mcc_miscoding",
     "chargeback_rate_bps > 100  AND  refund_rate_count > 0.05"),
    ("issuer_prohibition_rule", "mcc_miscoding",
     "pct_decline_not_permitted > 0.05"),
    ("cash_disbursement_rule", "cash",
     "pct_round_100 > 0.40  AND  avg_ticket_usd > 400  AND  pct_ticket_gt_500 > 0.30"),
    ("interchange_abuse_rule", "mcc_abuse",
     "interchange_advantage_bps > 50 on a cheap band  OR  CNP-vs-expected > 0.55 with advantage > 25"),
]


def build(data_dir):
    s = pd.read_csv(os.path.join(data_dir, "merchant_scores.csv"), low_memory=False)
    gt = pd.read_csv(os.path.join(data_dir, "ground_truth_labels.csv"), low_memory=False)
    gt_cols = ["merchant_id", "archetype", "integrity_category", "integrity_tier",
               "descriptor_churn", "is_integrity_violation", "is_interchange_abuse"]
    gt = gt[[c for c in gt_cols if c in gt.columns]]
    s = s.merge(gt, on="merchant_id", how="left", suffixes=("", "_gt"))

    flagged_mask = s["flag_for_investigation"] == 1
    s["pred_family"] = np.where(
        flagged_mask, s.apply(primary_family, axis=1), "")
    s["true_family"] = s["archetype"].map(ARCH_FAMILY)

    models = []

    # ---- 1. six method / family detectors -----------------------------------
    for m in METHOD_MODELS:
        weights = PATTERN_WEIGHTS[m["weights_key"]]
        fam = m["family"]
        score_col = s.get(m["output"], pd.Series(0.0, index=s.index))

        # each model is scored on TWO honest views:
        #   auc      — threshold-free discrimination of the model's own score vs its GT class
        #   operating point — precision/recall at the deployed decision
        if fam == "descriptor":
            # descriptor is a cross-cutting supporting signal, not an exclusive class.
            # Score it on its own job: does score_descriptor separate churners?
            actual = s["descriptor_churn"].fillna(0).astype(bool)
            op = binary_metrics(score_col >= 70, actual)
            op_desc = "score_descriptor ≥ 70"
            gt_note = "vs. planted descriptor-churn behaviour"
        elif fam == "mcc_miscoding":
            actual = s["archetype"].fillna("").str.startswith("miscoded_")
            op = binary_metrics(score_col >= 70, actual)
            op_desc = "score_mcc_miscoding ≥ 70"
            gt_note = "vs. planted content-miscoding archetypes"
        else:
            # rule-driven families: the deployed decision is the family routing itself
            actual = s["true_family"] == fam
            op = binary_metrics(s["pred_family"] == fam, actual)
            op_desc = "family routing (score + rule)"
            gt_note = f"vs. planted {FAMILY_LABEL[fam]} archetype"

        metrics = dict(op)
        metrics["auc"] = auc(score_col, actual)
        metrics["operatingPoint"] = op_desc
        metrics["gtNote"] = gt_note
        feats = features_from(weights)
        models.append({
            "id": m["id"], "name": m["name"], "family": fam,
            "kind": "method-detector",
            "typeLabel": "Peer-normalized logistic scorer",
            "version": m["version"], "status": m["status"],
            "summary": m["summary"], "detects": m["detects"],
            "output": m["output"],
            "features": feats, "featureCount": len(feats),
            "calibration": {
                "link": "logistic", "k": LOGISTIC_K,
                "normalization": "peer z-score (same-MCC cohort, shrunk to global for thin peers)",
                "output": f"{m['output']} · 0–100",
            },
            "rules": [
                {"name": r, "expr": expr, "family": rfam}
                for (r, rfam, expr) in RULE_PACK if r in m["rules"]
            ],
            "metrics": metrics,
        })

    # ---- 2. composite ensemble ----------------------------------------------
    target = (s["is_integrity_violation"].fillna(False).astype(bool)
              | s["is_interchange_abuse"].fillna(False).astype(bool))
    ens_metrics = binary_metrics(flagged_mask, target)
    ens_metrics["auc"] = auc(s.get("integrity_risk_score", pd.Series(0.0, index=s.index)), target)
    ens_metrics["operatingPoint"] = "flag_for_investigation (score ≥ 85 OR rule)"
    ens_metrics["gtNote"] = "vs. any planted integrity violation or interchange abuse"
    models.append({
        "id": "ensemble-integrity", "name": "Integrity Composite", "family": "ensemble",
        "kind": "ensemble",
        "typeLabel": "Weighted logistic ensemble + tiering",
        "version": "3.0.0", "status": "production",
        "summary": "The portfolio risk score. A single weighted combination of the strongest "
                   "cross-typology signals — not a max over the sub-models, which would inflate "
                   "every merchant. Binned into Low → Critical tiers.",
        "detects": "Any merchant whose overall behaviour departs from its declared category, "
                   "across all six typologies at once.",
        "output": "integrity_risk_score",
        "features": features_from(OVERALL_WEIGHTS),
        "featureCount": len(OVERALL_WEIGHTS),
        "calibration": {
            "link": "logistic", "k": COMPOSITE_K,
            "normalization": "peer z-score → weighted sum → logistic",
            "tiers": [
                {"tier": "Low", "range": "≤ 60"},
                {"tier": "Monitor", "range": "60–75"},
                {"tier": "Elevated", "range": "75–85"},
                {"tier": "High", "range": "85–93"},
                {"tier": "Critical", "range": "> 93"},
            ],
            "output": "integrity_risk_score · 0–100 + risk_tier",
        },
        "rules": [],
        "metrics": ens_metrics,
    })

    # ---- 3. content sub-classifier bank (MCC miscoding P1/P2/P3) -------------
    sub_models = []
    flagged = s[flagged_mask]
    for cat, weights in CATEGORY_WEIGHTS.items():
        tier = CATEGORY_TIER.get(cat, "—")
        actual_cat = s["integrity_category"].fillna("") == cat
        # predicted positive: content model is this merchant's argmax category among flagged
        pred_cat = flagged_mask & (s.get("top_category", pd.Series("", index=s.index)) == cat)
        cm = binary_metrics(pred_cat, actual_cat)
        sub_models.append({
            "key": cat, "label": CATEGORY_LABEL.get(cat, cat), "tier": tier,
            "features": features_from(weights), "featureCount": len(weights),
            "support": int(actual_cat.sum()),
            "flagged": int((pred_cat).sum()),
            "topFeatures": [f["label"] for f in features_from(weights)[:3]],
            "metrics": cm,
        })
    # priority-tier rollup detection (the reliable read — argmax category is directional)
    tier_metrics = {}
    for t in ["P1", "P2", "P3"]:
        actual_t = s["integrity_tier"].fillna("") == t
        cats_in_tier = [c for c, tt in CATEGORY_TIER.items() if tt == t]
        top = s.get("top_category", pd.Series("", index=s.index))
        pred_t = flagged_mask & top.isin(cats_in_tier)
        tier_metrics[t] = binary_metrics(pred_t, actual_t)

    content_bank = {
        "id": "content-bank", "name": "MCC-Miscoding Content Bank", "family": "mcc_miscoding",
        "kind": "content-classifier",
        "typeLabel": "11 peer-normalized content classifiers (P1/P2/P3)",
        "version": "2.3.0", "status": "production",
        "summary": "Eleven behavioural fingerprints for the prohibited / restricted verticals a "
                   "miscoder hides inside. The argmax names the likely concealed category; the "
                   "P1/P2/P3 rollup is the reliable, audited read.",
        "detects": "Which prohibited vertical a miscoded merchant most resembles.",
        "output": "top_category · score_<category>",
        "calibration": {
            "link": "logistic", "k": LOGISTIC_K,
            "normalization": "peer z-score (same-MCC cohort)",
            "output": "score_<category> · 0–100",
        },
        "subModels": sorted(sub_models, key=lambda d: (d["tier"], -d["support"])),
        "tierMetrics": tier_metrics,
        "note": "Within-category argmax attribution is directional on saturated scores; "
                "the P1/P2/P3 tier detection is measured against planted labels.",
    }

    # ---- 4. expert-rule pack ------------------------------------------------
    rule_entries = []
    for (name, fam, expr) in RULE_PACK:
        fired = int(s[name].fillna(0).astype(int).sum()) if name in s.columns else 0
        rule_entries.append({
            "name": name, "family": fam, "expr": expr, "fired": fired,
        })
    rule_pack = {
        "id": "rule-pack", "name": "Expert Rule Pack", "family": "rules",
        "kind": "expert-rules",
        "typeLabel": "9 deterministic gates",
        "version": "2.2.0", "status": "production",
        "summary": "A transparent, non-ML complement to the scorers. Each gate is a hard, "
                   "auditable threshold; a merchant reaches the queue via the model OR the rules, "
                   "so a clean-scoring merchant that trips a rule is still surfaced.",
        "detects": "Bright-line policy breaches that must fire regardless of the learned score.",
        "output": "rules_triggered · flag_reason",
        "rules": rule_entries,
        "totalFired": int(sum(r["fired"] for r in rule_entries)),
    }

    return {
        "meta": {
            "source": "MCC Miscoding synthetic dataset v2",
            "merchantsScored": int(len(s)),
            "flaggedMerchants": int(flagged_mask.sum()),
            "note": "All entities synthetic. Feature weights and calibration are the live "
                    "pipeline's; precision/recall are measured against planted labels. "
                    "Outputs are decision-support indicators, not final determinations.",
            "featureGlossaryCount": len(FEATURE_LABEL),
        },
        "models": models,
        "contentBank": content_bank,
        "rulePack": rule_pack,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../MCC Miscoding Data v2/data")
    ap.add_argument("--out", default="../src/data/models.generated.json")
    a = ap.parse_args()

    payload = build(a.data)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(payload, fh, indent=2)
    size = os.path.getsize(a.out)
    print(f"wrote {a.out}  ({size/1024:.1f} KB)")
    for m in payload["models"]:
        mt = m["metrics"]
        auc_s = f"{mt['auc']:.2f}" if mt.get("auc") is not None else "  — "
        print(f"  {m['name']:28s} AUC={auc_s} P={mt['precision']:.2f} R={mt['recall']:.2f} "
              f"F1={mt['f1']:.2f}  n={mt['support']}  feats={m['featureCount']}")
    cb = payload["contentBank"]
    print(f"  content bank: {len(cb['subModels'])} classifiers, "
          f"tier detection " + ", ".join(
              f"{t} R={cb['tierMetrics'][t]['recall']:.2f}" for t in ["P1", "P2", "P3"]))
    print(f"  rule pack: {payload['rulePack']['totalFired']} total rule firings")


if __name__ == "__main__":
    main()
