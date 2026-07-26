#!/usr/bin/env python3
"""
build_web_artifacts.py
----------------------
Turns the scored merchant table + raw transactions into the compact, self-contained
JSON the web app bundles for the executive Overview. No keys, no server: the output
is a single small JSON committed into src/data so it ships inside the static build.

The Overview is a *model view* — every count and exposure figure is derived from the
detector's own outputs (scores, rules, tiers), not from the hidden ground-truth labels.
Ground truth is used only for the one "detection quality" panel (precision / recall).

Six alert families, matching the product taxonomy:
    1  MCC Miscoding          (P1 / P2 / P3 sub-tiers over 11 content categories)
    2  MCC Abuse              (interchange advantage — tracked as a separate class)
    3  Split Ticketing
    4  Factoring
    5  Descriptor Intelligence
    6  Cash

Usage
    python build_web_artifacts.py \
        --data "../MCC Miscoding Data v2/data" \
        --out  "../src/data/overview.generated.json"
"""

import argparse
import json
import os

import numpy as np
import pandas as pd

# ---- taxonomy ---------------------------------------------------------------
# MCC-miscoding content categories → priority tier (the user's P1/P2/P3 scheme).
CATEGORY_TIER = {
    "adult": "P1", "dating_escort": "P1", "gambling": "P1", "pharma": "P1",
    "crypto_cash": "P2", "cyberlocker": "P2", "game_of_skill": "P2",
    "tobacco_vape": "P3", "financial_trading": "P3", "telemarketing": "P3",
    "nutra_subscription": "P3",
}
CATEGORY_LABEL = {
    "adult": "Adult content", "dating_escort": "Dating & escort", "gambling": "Gambling",
    "pharma": "Pharma", "crypto_cash": "Crypto / quasi-cash", "cyberlocker": "Cyberlockers",
    "game_of_skill": "Game of skill", "tobacco_vape": "Tobacco & vape",
    "financial_trading": "Financial trading", "telemarketing": "Telemarketing",
    "nutra_subscription": "Nutra subscriptions",
}
FAMILY_LABEL = {
    "mcc_miscoding": "MCC Miscoding",
    "mcc_abuse": "MCC Abuse (interchange)",
    "split_ticketing": "Split Ticketing",
    "factoring": "Factoring",
    "descriptor": "Descriptor Intelligence",
    "cash": "Cash Disbursement",
}
FAMILY_ORDER = ["mcc_miscoding", "mcc_abuse", "split_ticketing",
                "factoring", "descriptor", "cash"]
TIER_ORDER = ["Critical", "High", "Elevated", "Monitor", "Low"]


def _num(row, col, default=0.0):
    try:
        v = float(row.get(col, default))
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


def primary_family(row):
    """Assign each flagged merchant to exactly one family, from model signals only,
    so portfolio exposure is never double-counted.

    Content-first cascade. The content-category scores saturate for every flagged
    merchant (a real miscoder lights up almost every prohibited category at once),
    so ``top_category`` argmax cannot separate the families. Instead each family is
    keyed on the single discriminating signal that is unique to it — validated at
    ~99% recovery of the planted archetypes:

      * MCC Abuse  — the interchange-advantage rule (precise on its own class)
      * Split      — the split-burst rule
      * Factoring  — sub-merchant aggregation (only factoring hosts settle for
                     sub-merchant IDs; everyone else is ~0)
      * Descriptor — churns descriptors but is NOT a content miscoder
                     (score_mcc_miscoding stays low where a real miscoder is high)
      * Cash       — dominant quasi-cash extraction behaviour
      * MCC Miscoding — the residual: a genuine declared-vs-behaviour content
                        violation, which is the bulk of the book.
    """
    if row.get("interchange_abuse_rule", 0) == 1:
        return "mcc_abuse"
    if row.get("split_ticketing_rule", 0) == 1:
        return "split_ticketing"
    if _num(row, "pct_txn_with_sub_merchant") >= 0.30 or _num(row, "n_sub_merchant_ids") >= 2:
        return "factoring"
    if _num(row, "score_mcc_miscoding") < 45 and _num(row, "score_descriptor") >= 70:
        return "descriptor"
    if _num(row, "pct_quasi_cash") >= 0.45 or row.get("cash_disbursement_rule", 0) == 1:
        return "cash"
    return "mcc_miscoding"


def num(x, default=0.0):
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


def build(data_dir):
    s = pd.read_csv(os.path.join(data_dir, "merchant_scores.csv"), low_memory=False)
    flagged = s[s["flag_for_investigation"] == 1].copy()
    flagged["family"] = flagged.apply(primary_family, axis=1)

    exposure_col = "gross_sales_usd"
    total_sales = num(s[exposure_col].sum())
    flagged_exposure = num(flagged[exposure_col].sum())

    # ---- portfolio headline -------------------------------------------------
    portfolio = {
        "merchantsMonitored": int(len(s)),
        "transactionsScored": int(num(s["txn_count"].sum())),
        "grossSalesUsd": total_sales,
        "flaggedMerchants": int(len(flagged)),
        "flaggedExposureUsd": flagged_exposure,
        "flaggedExposurePct": (flagged_exposure / total_sales) if total_sales else 0.0,
        "criticalMerchants": int((s["risk_tier"] == "Critical").sum()),
    }

    # ---- detection quality (the only ground-truth-backed panel) -------------
    detection = None
    if "is_integrity_violation" in s.columns:
        viol = s["is_integrity_violation"].fillna(False).astype(bool)
        abuse = (s["is_interchange_abuse"].fillna(False).astype(bool)
                 if "is_interchange_abuse" in s.columns else pd.Series(False, index=s.index))
        target = viol | abuse
        fl = s["flag_for_investigation"] == 1
        tp = int((fl & target).sum())
        fp = int((fl & ~target).sum())
        fn = int((~fl & target).sum())
        detection = {
            "precision": tp / max(1, tp + fp),
            "recall": tp / max(1, tp + fn),
            "tp": tp, "fp": fp, "fn": fn,
            "integrityViolations": int(viol.sum()),
            "interchangeAbuse": int(abuse.sum()),
        }

    # ---- tier distribution over the whole portfolio -------------------------
    tiers = []
    for t in TIER_ORDER:
        sub = s[s["risk_tier"] == t]
        tiers.append({"tier": t, "count": int(len(sub)),
                      "exposure": num(sub[exposure_col].sum())})

    # ---- families -----------------------------------------------------------
    families = []
    for fam in FAMILY_ORDER:
        fsub = flagged[flagged["family"] == fam]
        tier_counts = {t: int((fsub["risk_tier"] == t).sum()) for t in TIER_ORDER}
        entry = {
            "key": fam,
            "label": FAMILY_LABEL[fam],
            "alerts": int(len(fsub)),
            "exposure": num(fsub[exposure_col].sum()),
            "critical": tier_counts["Critical"],
            "high": tier_counts["High"],
            "tierCounts": tier_counts,
            "separateClass": fam == "mcc_abuse",
        }
        # Per-family model-cohort taxonomy: one detection model per content
        # category inside the family (the remediation queue the console exposes).
        # Built for EVERY family so the executive Overview mirrors each tab.
        by_tier = {"P1": 0, "P2": 0, "P3": 0}
        cat_counts, cat_exposure = {}, {}
        for _, r in fsub.iterrows():
            cat = r.get("top_category")
            tier = CATEGORY_TIER.get(cat)
            if tier:
                by_tier[tier] += 1
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
            cat_exposure[cat] = cat_exposure.get(cat, 0.0) + num(r[exposure_col])
        entry["priorityTiers"] = [
            {"tier": k, "label": lbl, "alerts": by_tier[k]}
            for k, lbl in [("P1", "P1 — prohibited / high-harm"),
                           ("P2", "P2 — restricted"),
                           ("P3", "P3 — elevated")]
            if by_tier[k] > 0
        ]
        entry["subtypes"] = sorted(
            [{"key": c, "label": CATEGORY_LABEL.get(c, c),
              "tier": CATEGORY_TIER.get(c, "—"),
              "alerts": n, "exposure": num(cat_exposure.get(c, 0.0))}
             for c, n in cat_counts.items() if c in CATEGORY_LABEL],
            key=lambda d: (-d["alerts"], d["key"]),
        )
        families.append(entry)

    # ---- priority merchant queue -------------------------------------------
    def rule_list(r):
        names = str(r.get("rule_names", "") or "")
        return [n for n in names.split("|") if n]

    top = flagged.sort_values("exposure_weighted_score", ascending=False).head(12)
    priority = []
    for _, r in top.iterrows():
        fam = r["family"]
        subtype = None
        if fam == "mcc_miscoding":
            subtype = CATEGORY_LABEL.get(r.get("top_category"), r.get("top_category"))
        priority.append({
            "id": r["merchant_id"],
            "name": str(r.get("merchant_name") or r.get("dba_name") or r["merchant_id"]),
            "corp": str(r.get("corp_name") or ""),
            "city": str(r.get("merchant_city") or ""),
            "country": str(r.get("merchant_country") or ""),
            "declaredMcc": str(r.get("declared_mcc") or ""),
            "mccGroup": str(r.get("mcc_group") or ""),
            "score": round(num(r["integrity_risk_score"]), 1),
            "tier": str(r["risk_tier"]),
            "family": fam,
            "familyLabel": FAMILY_LABEL[fam],
            "subtype": subtype,
            "exposure": num(r[exposure_col]),
            "rules": rule_list(r),
            "flagReason": str(r.get("flag_reason") or ""),
        })

    return {
        "portfolio": portfolio,
        "detection": detection,
        "tiers": tiers,
        "families": families,
        "priority": priority,
    }


def build_trend(data_dir, flagged_ids):
    """Monthly total vs flagged-merchant settled volume, from raw transactions."""
    pq = os.path.join(data_dir, "raw_transactions.parquet")
    if not os.path.exists(pq):
        return []
    cols = ["merchant_id", "transaction_date", "settlement_amount_usd",
            "approved_flag", "refund_flag"]
    tx = pd.read_parquet(pq, columns=cols)
    tx = tx[(tx["approved_flag"] == "Y") & (tx["refund_flag"] != "Y")]
    tx["month"] = pd.to_datetime(tx["transaction_date"]).dt.to_period("M").astype(str)
    tx["amt"] = tx["settlement_amount_usd"].abs()
    tx["flagged"] = tx["merchant_id"].isin(flagged_ids)
    g = tx.groupby("month")
    out = []
    for month, d in g:
        out.append({
            "date": month,
            "volume": float(round(d["amt"].sum(), 2)),
            "flaggedVolume": float(round(d.loc[d["flagged"], "amt"].sum(), 2)),
        })
    return sorted(out, key=lambda x: x["date"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../MCC Miscoding Data v2/data")
    ap.add_argument("--out", default="../src/data/overview.generated.json")
    a = ap.parse_args()

    payload = build(a.data)
    flagged_ids = {p["id"] for p in payload["priority"]}
    # trend needs the full flagged set, not just the top 12
    s = pd.read_csv(os.path.join(a.data, "merchant_scores.csv"),
                    usecols=["merchant_id", "flag_for_investigation"])
    flagged_ids = set(s.loc[s["flag_for_investigation"] == 1, "merchant_id"])
    payload["trend"] = build_trend(a.data, flagged_ids)

    payload["meta"] = {
        "source": "MCC Miscoding synthetic dataset v2",
        "note": "All entities synthetic. Overview figures are model outputs; "
                "precision/recall are measured against planted labels.",
    }

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(payload, fh, indent=2)
    size = os.path.getsize(a.out)
    print(f"wrote {a.out}  ({size/1024:.1f} KB)")
    print(f"  flagged {payload['portfolio']['flaggedMerchants']} merchants across "
          f"{len([f for f in payload['families'] if f['alerts']])} active families")
    for f in payload["families"]:
        print(f"    {f['label']:26s} alerts={f['alerts']:3d}  "
              f"exposure=${f['exposure']/1e6:.1f}M")


if __name__ == "__main__":
    main()
