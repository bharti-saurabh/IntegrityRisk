"""
Recompute integrity_risk_score as a transparent function of the engineered
behavioral features, so every score is explainable by feature attribution.

Pipeline (all deterministic):
  1. For each merchant, compute a PEER-RELATIVE z-score per feature vs the
     CLEAN population declaring the same mcc_group (hierarchical fallback to a
     global clean baseline when a group has too few clean peers).
  2. Orient each feature so "higher = more abuse-like" (sign learned from the
     global clean-vs-abuse mean difference).
  3. Fit a single L2-regularised LogisticRegression on the oriented z-scores
     against ground truth (label != 'clean'). This is the "ML model": the score
     is 100 * P(abuse), and the per-feature log-odds term (coef * z) is the
     honest attribution that drives the score.
  4. Re-derive risk_tier (fixed cutpoints) and integrity_percentile (rank).
  5. Persist scalars back to merchants.json + merchants.parquet, and write a
     compact `drivers` array per merchant into merchants.json for the console.

Run:  python3 scripts/recompute_integrity_scores.py
"""
import json
import math
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "public" / "data" / "merchants.json"
PARQUET_PATH = ROOT / "public" / "data" / "merchants.parquet"

# Engineered behavioral features that carry abuse signal. Raw size features
# (txn_count, gross_sales, unique_cards) are excluded — they scale a merchant,
# they don't indicate disguised-prohibited behavior.
FEATURES = [
    ("pct_quasi_cash", "Quasi-cash share"),
    ("pct_round_100", "Round-$100 tickets"),
    ("avg_ticket_usd", "Avg ticket size"),
    ("pct_cnp", "Card-not-present share"),
    ("pct_cross_border", "Cross-border share"),
    ("pct_recurring", "Recurring share"),
    ("chargeback_rate_bps", "Chargeback rate"),
    ("refund_rate_amount", "Refund rate"),
    ("n_distinct_descriptors", "Descriptor cycling"),
    ("interchange_advantage_bps", "Interchange advantage"),
    ("effective_interchange_bps", "Effective interchange"),
]
FKEYS = [k for k, _ in FEATURES]
LABELS = {k: lbl for k, lbl in FEATURES}

MIN_PEERS = 8  # need at least this many clean peers to trust a group baseline


def load():
    return json.loads(JSON_PATH.read_text())


def baseline_stats(rows, mask_idx):
    """mean/std for each feature over the given row indices."""
    stats = {}
    for k in FKEYS:
        vals = np.array([float(rows[i].get(k) or 0.0) for i in mask_idx], dtype=float)
        mu = float(vals.mean()) if len(vals) else 0.0
        sd = float(vals.std(ddof=0)) if len(vals) else 1.0
        stats[k] = (mu, sd if sd > 1e-9 else 1.0)
    return stats


def main():
    rows = load()
    n = len(rows)
    clean_idx = [i for i, r in enumerate(rows) if r["label"] == "clean"]

    # --- global clean baseline (fallback) ---
    global_base = baseline_stats(rows, clean_idx)

    # --- per-group clean baselines ---
    groups = {}
    for i, r in enumerate(rows):
        groups.setdefault(r["mcc_group"], []).append(i)
    group_base = {}
    for grp, idxs in groups.items():
        cidx = [i for i in idxs if rows[i]["label"] == "clean"]
        group_base[grp] = baseline_stats(rows, cidx) if len(cidx) >= MIN_PEERS else global_base

    # --- orientation: sign of (abuse_mean - clean_mean) globally ---
    abuse_idx = [i for i, r in enumerate(rows) if r["label"] != "clean"]
    orient = {}
    for k in FKEYS:
        cm = np.mean([float(rows[i].get(k) or 0.0) for i in clean_idx])
        am = np.mean([float(rows[i].get(k) or 0.0) for i in abuse_idx])
        orient[k] = 1.0 if (am - cm) >= 0 else -1.0

    # --- oriented peer-relative z per merchant ---
    Z = np.zeros((n, len(FKEYS)))
    for i, r in enumerate(rows):
        base = group_base.get(r["mcc_group"], global_base)
        for j, k in enumerate(FKEYS):
            mu, sd = base[k]
            z = (float(r.get(k) or 0.0) - mu) / sd
            Z[i, j] = float(np.clip(orient[k] * z, -4.0, 8.0))

    y = np.array([0 if rows[i]["label"] == "clean" else 1 for i in range(n)])

    # --- the ML model: L2 logistic regression on oriented z-scores ---
    clf = LogisticRegression(C=0.6, max_iter=2000, class_weight="balanced")
    clf.fit(Z, y)
    coef = clf.coef_[0]
    intercept = float(clf.intercept_[0])
    proba = clf.predict_proba(Z)[:, 1]

    # --- score, tier, percentile ---
    score = 100.0 * proba
    order = np.argsort(np.argsort(score))  # rank ascending
    percentile = 100.0 * order / (n - 1)

    def tier(s):
        if s >= 90: return "Critical"
        if s >= 80: return "High"
        if s >= 65: return "Elevated"
        if s >= 45: return "Monitor"
        return "Low"

    # The feature-composite is a MODEL for the model-routed universe only:
    # MCC-miscoding merchants + the clean population the model screens. The
    # other five families (split-ticketing, factoring, cash, surcharge,
    # mcc-abuse) are RULE-routed — their abuse is transaction-sequence based and
    # invisible to merchant-level aggregates, so their original rule-driven
    # scores are preserved and they carry no feature-attribution drivers.
    MODEL_ROUTED = {"", "mcc_miscoding"}

    orig_score = {r["merchant_id"]: float(r["integrity_risk_score"]) for r in rows}

    # First pass: assign the blended final score per merchant.
    for i, r in enumerate(rows):
        if r["family"] in MODEL_ROUTED:
            r["_final"] = float(round(score[i], 1))
        else:
            r["_final"] = orig_score[r["merchant_id"]]

    # Percentile ranks over the FINAL (blended) score population.
    finals = np.array([r["_final"] for r in rows])
    frank = np.argsort(np.argsort(finals))

    for i, r in enumerate(rows):
        s = r.pop("_final")
        r["integrity_risk_score"] = s
        r["integrity_percentile"] = float(round(100.0 * frank[i] / (n - 1), 1))
        r["risk_tier"] = tier(s)
        gross = float(r.get("gross_sales_usd") or 0.0)
        r["exposure_weighted_score"] = float(round(s * math.log10(max(gross, 10.0)), 1))
        r["flag_for_investigation"] = 1 if s >= 65 else 0

        # Feature-attribution drivers only for the model-routed universe.
        if r["family"] not in MODEL_ROUTED:
            r["drivers"] = []
            continue
        contribs = []
        for j, k in enumerate(FKEYS):
            c = float(coef[j] * Z[i, j])  # log-odds contribution
            contribs.append((k, float(Z[i, j]), float(coef[j]), c))
        pos_sum = sum(c for *_, c in contribs if c > 0) or 1.0
        drivers = []
        for k, z, w, c in sorted(contribs, key=lambda t: -t[3]):
            if c <= 0.02:  # only surface features pushing the score UP
                continue
            drivers.append({
                "key": k,
                "label": LABELS[k],
                "z": round(z, 2),
                "coef": round(w, 3),
                "contribution": round(c, 3),
                "share": round(c / pos_sum, 3),
            })
        r["drivers"] = drivers[:6]

    # --- diagnostics ---
    from collections import Counter
    print("coefficients (oriented z -> log-odds):")
    for k, w in sorted(zip(FKEYS, coef), key=lambda t: -abs(t[1])):
        print(f"  {k:26s} {w:+.3f}  orient={orient[k]:+.0f}")
    print(f"  intercept {intercept:+.3f}")
    print("\ntier distribution:", dict(Counter(r["risk_tier"] for r in rows)))
    # separation
    cs = score[y == 0]; as_ = score[y == 1]
    print(f"clean score  mean={cs.mean():.1f} p95={np.percentile(cs,95):.1f}")
    print(f"abuse score  mean={as_.mean():.1f} p05={np.percentile(as_,5):.1f}")

    def show(mid):
        r = next(r for r in rows if r["merchant_id"] == mid)
        print(f"\n{mid} {r['merchant_name']} [{r['label']}] mcc={r['declared_mcc']} grp={r['mcc_group']}")
        print(f"  score={r['integrity_risk_score']} tier={r['risk_tier']} pct={r['integrity_percentile']}")
        for d in r["drivers"]:
            print(f"    {d['label']:22s} z={d['z']:+.2f} coef={d['coef']:+.3f} contrib={d['contribution']:+.3f} share={d['share']*100:.0f}%")

    show("MID0000425")  # Miami — true positive
    show("MID0000454")  # Nicosia — decoupled/clean

    # --- persist json ---
    JSON_PATH.write_text(json.dumps(rows, separators=(",", ":")))
    print(f"\nwrote {JSON_PATH} ({JSON_PATH.stat().st_size//1024} KB)")

    # --- persist parquet (scalar columns only; drivers stay JSON-only) ---
    tbl = pq.read_table(PARQUET_PATH)
    cols = {name: tbl[name] for name in tbl.column_names}
    by_id = {r["merchant_id"]: r for r in rows}
    ids = tbl["merchant_id"].to_pylist()
    for col in ["integrity_risk_score", "integrity_percentile", "exposure_weighted_score", "flag_for_investigation"]:
        cols[col] = pa.array([by_id[m][col] for m in ids])
    cols["risk_tier"] = pa.array([by_id[m]["risk_tier"] for m in ids])
    new_tbl = pa.table(cols)
    pq.write_table(new_tbl, PARQUET_PATH)
    print(f"wrote {PARQUET_PATH} ({PARQUET_PATH.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
