#!/usr/bin/env python3
"""
build_explorer_data.py
----------------------
Produces the compact, shippable data slice the web Data Explorer loads directly
in the browser — no server, no keys. Two consumers:

  * UI table mode  -> public/data/merchants.json   (1,492 merchants, curated cols)
  * SQL console    -> public/data/*.parquet         (DuckDB-WASM reads these)

The full raw_transactions.parquet is ~109 MB (909 K rows) — far too big to ship.
We slice it to a representative subset that still ties cleanly to the merchant
table and exposes every typology:

  * ALL 236 flagged merchants, each capped to their most-recent 400 transactions
    (contiguous by time, so split-bursts / descriptor rotations stay intact)
  * 150 sampled clean merchants as a baseline, capped to 250 each

All entities are synthetic; PANs are already masked upstream. Ground-truth labels
are folded in only as a coarse `label` column, so the demo can be explored honestly.

Usage
    python build_explorer_data.py \
        --data "../MCC Miscoding Data v2/data" \
        --out  "../public/data"
"""

import argparse
import json
import os

import numpy as np
import pandas as pd

from build_web_artifacts import primary_family, FAMILY_LABEL, CATEGORY_LABEL

# ---- deterministic slice knobs ---------------------------------------------
FLAGGED_CAP = 400
CLEAN_SAMPLE = 150
CLEAN_CAP = 250
SEED = 20260724

# Columns kept in the shipped transaction slice — demo-meaningful, PAN masked.
TXN_COLS = [
    "transaction_id", "transaction_datetime_utc", "transaction_date", "local_hour",
    "day_of_week", "merchant_id", "merchant_name", "dba_id", "corp_id",
    "merchant_descriptor", "sub_merchant_id", "merchant_city", "merchant_country",
    "mcc", "mcc_description", "settlement_amount_usd", "transaction_currency_code",
    "pan_masked", "card_token_id", "issuer_country", "channel", "card_present_flag",
    "cardholder_present_flag", "recurring_flag", "moto_flag", "token_flag",
    "pos_entry_mode_desc", "transaction_type_desc", "approved_flag",
    "interchange_fee_usd", "interchange_rate_designator", "cashback_amount",
    "refund_flag", "chargeback_flag", "chargeback_amount_usd", "fraud_flag",
    "domestic_xborder_flag", "split_group_id",
]

# Curated merchant columns for the UI table + SQL merchant view.
MERCH_COLS = [
    "merchant_id", "merchant_name", "corp_name", "merchant_city", "merchant_country",
    "declared_mcc", "mcc_group", "txn_count", "unique_cards", "gross_sales_usd",
    "avg_ticket_usd", "pct_cnp", "pct_recurring", "pct_quasi_cash", "pct_round_100",
    "pct_cross_border", "chargeback_rate_bps", "refund_rate_amount",
    "effective_interchange_bps", "interchange_advantage_bps",
    "n_distinct_descriptors", "pct_txn_with_sub_merchant",
    "integrity_risk_score", "integrity_percentile", "exposure_weighted_score",
    "risk_tier", "top_category", "top_pattern", "flag_for_investigation",
    "rule_names", "flag_reason",
]


def build_merchants(data_dir):
    s = pd.read_csv(os.path.join(data_dir, "merchant_scores.csv"), low_memory=False)
    gt = pd.read_csv(os.path.join(data_dir, "ground_truth_labels.csv"))

    keep = [c for c in MERCH_COLS if c in s.columns]
    m = s[keep].copy()

    # Family: reuse the exact detector-only cascade the Overview uses.
    fam = s.apply(primary_family, axis=1)
    flagged = s["flag_for_investigation"] == 1
    m["family"] = np.where(flagged, fam, "")
    m["family_label"] = m["family"].map(lambda k: FAMILY_LABEL.get(k, ""))
    m["subtype"] = np.where(
        flagged & (fam == "mcc_miscoding"),
        s["top_category"].map(lambda c: CATEGORY_LABEL.get(c, "")),
        "",
    )

    # Coarse synthetic label for honest exploration (GT is synthetic).
    lbl = gt.set_index("merchant_id")
    viol = s["merchant_id"].map(lbl["is_integrity_violation"] if "is_integrity_violation" in lbl else {})
    abuse = s["merchant_id"].map(lbl["is_interchange_abuse"] if "is_interchange_abuse" in lbl else {})
    m["label"] = np.select(
        [abuse.fillna(False).astype(bool), viol.fillna(False).astype(bool)],
        ["interchange_abuse", "integrity_violation"],
        default="clean",
    )
    return m


def build_transactions(data_dir, merch):
    flagged_ids = list(merch.loc[merch["flag_for_investigation"] == 1, "merchant_id"])
    clean_ids = list(merch.loc[merch["flag_for_investigation"] == 0, "merchant_id"])

    rng = np.random.default_rng(SEED)
    clean_pick = set(rng.choice(clean_ids, size=min(CLEAN_SAMPLE, len(clean_ids)), replace=False))
    wanted = set(flagged_ids) | clean_pick
    caps = {mid: FLAGGED_CAP for mid in flagged_ids}
    caps.update({mid: CLEAN_CAP for mid in clean_pick})

    cols = [c for c in TXN_COLS]
    tx = pd.read_parquet(os.path.join(data_dir, "raw_transactions.parquet"), columns=cols)
    tx = tx[tx["merchant_id"].isin(wanted)].copy()
    tx["_ord"] = pd.to_datetime(tx["transaction_datetime_utc"])

    # Keep each merchant's most-recent window so split groups stay contiguous.
    tx = tx.sort_values(["merchant_id", "_ord"])
    parts = []
    for mid, g in tx.groupby("merchant_id", sort=False):
        parts.append(g.tail(caps.get(mid, CLEAN_CAP)))
    out = pd.concat(parts, ignore_index=True).drop(columns=["_ord"])
    return out.sort_values(["transaction_datetime_utc", "merchant_id"]).reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../MCC Miscoding Data v2/data")
    ap.add_argument("--out", default="../public/data")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    merch = build_merchants(a.data)
    txn = build_transactions(a.data, merch)

    # merchants.json — UI table (numbers rounded to keep the payload small)
    mj = merch.copy()
    for c in mj.select_dtypes(include=["float64", "float32"]).columns:
        mj[c] = mj[c].round(2)
    mj.to_json(os.path.join(a.out, "merchants.json"), orient="records")

    # parquet — SQL console (DuckDB-WASM)
    merch.to_parquet(os.path.join(a.out, "merchants.parquet"), index=False, compression="zstd")
    txn.to_parquet(os.path.join(a.out, "transactions.parquet"), index=False, compression="zstd")

    meta = {
        "source": "MCC Miscoding synthetic dataset v2",
        "note": "All entities synthetic; PANs masked. Transaction slice is a "
                "representative subset (all flagged merchants + sampled clean), "
                "not the full book.",
        "tables": {
            "merchants": {"rows": int(len(merch)), "columns": list(merch.columns)},
            "transactions": {"rows": int(len(txn)), "columns": list(txn.columns)},
        },
        "slice": {
            "flaggedCap": FLAGGED_CAP, "cleanSample": CLEAN_SAMPLE, "cleanCap": CLEAN_CAP,
            "flaggedMerchants": int((merch["flag_for_investigation"] == 1).sum()),
        },
    }
    with open(os.path.join(a.out, "explorer-meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)

    def sz(f):
        return os.path.getsize(os.path.join(a.out, f)) / 1024

    print("wrote to", a.out)
    for f in ["merchants.json", "merchants.parquet", "transactions.parquet", "explorer-meta.json"]:
        print(f"  {f:26s} {sz(f):8.1f} KB")
    print(f"  merchants rows={len(merch)}  transactions rows={len(txn)}")


if __name__ == "__main__":
    main()
