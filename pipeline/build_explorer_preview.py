#!/usr/bin/env python3
"""
build_explorer_preview.py
-------------------------
Emits public/data/transactions-preview.json — a tiny, offline-safe sample of the
transaction-level table so the Data Explorer "Preview" tab can show what the raw
data looks like WITHOUT booting DuckDB / fetching a CDN. It mirrors the exact slice
the SQL console queries (public/data/transactions.parquet), so the preview is faithful.

We curate a diverse handful of merchants — a few flagged ones spanning different
typology families (so split_group_id, cross-border, chargebacks, recurring all show
up) plus a couple of clean baselines — and take a short, contiguous, most-recent
window from each. All entities are synthetic; PANs are already masked upstream.

Usage
    python build_explorer_preview.py --out ../public/data
"""

import argparse
import json
import os

import pandas as pd

# Demo-meaningful preview columns (the full slice has ~38; this keeps the table legible).
PREVIEW_COLS = [
    "transaction_date", "local_hour", "merchant_id", "merchant_name",
    "merchant_descriptor", "merchant_country", "mcc", "mcc_description",
    "settlement_amount_usd", "transaction_currency_code", "pan_masked",
    "issuer_country", "channel", "card_present_flag", "recurring_flag",
    "approved_flag", "chargeback_flag", "split_group_id",
]

ROWS_PER_MERCHANT = 14
FLAGGED_FAMILIES = 5   # distinct flagged families to showcase
CLEAN_MERCHANTS = 2    # baseline clean merchants


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../public/data")
    a = ap.parse_args()

    tx = pd.read_parquet(os.path.join(a.out, "transactions.parquet"))
    merch = pd.read_json(os.path.join(a.out, "merchants.json"))

    m_idx = merch.set_index("merchant_id")
    flagged = merch[merch["flag_for_investigation"] == 1].copy()
    clean = merch[merch["flag_for_investigation"] == 0].copy()

    # Pick one representative flagged merchant per family (highest exposure), so the
    # preview spans typologies rather than repeating one pattern.
    picks = []
    seen_fam = set()
    for _, r in flagged.sort_values("exposure_weighted_score", ascending=False).iterrows():
        fam = r.get("family", "")
        if fam and fam not in seen_fam:
            seen_fam.add(fam)
            picks.append(r["merchant_id"])
        if len(picks) >= FLAGGED_FAMILIES:
            break
    picks += list(clean.sort_values("txn_count", ascending=False)["merchant_id"].head(CLEAN_MERCHANTS))

    parts = []
    for mid in picks:
        g = tx[tx["merchant_id"] == mid].sort_values("transaction_datetime_utc")
        parts.append(g.tail(ROWS_PER_MERCHANT))
    prev = pd.concat(parts, ignore_index=True) if parts else tx.head(0)

    keep = [c for c in PREVIEW_COLS if c in prev.columns]
    prev = prev[keep].copy()
    for c in prev.select_dtypes(include=["float64", "float32"]).columns:
        prev[c] = prev[c].round(2)
    # JSON-safe: nullable ints / NaN -> None
    prev = prev.astype(object).where(pd.notnull(prev), None)
    rows = prev.to_dict(orient="records")

    def family_of(mid):
        try:
            return str(m_idx.loc[mid, "family_label"]) or "Clean baseline"
        except Exception:
            return ""

    out = {
        "meta": {
            "source": "MCC Miscoding synthetic dataset v2",
            "note": "Synthetic entities; PANs masked. A curated cross-typology sample "
                    "of the shipped transaction slice — the same table the SQL console "
                    "queries. Not the full book.",
            "totalRowsInSlice": int(len(tx)),
            "totalColumnsInSlice": int(tx.shape[1]),
            "previewRows": int(len(rows)),
            "previewColumns": keep,
            "merchants": [
                {"merchant_id": mid, "family": family_of(mid)} for mid in picks
            ],
        },
        "rows": rows,
    }

    path = os.path.join(a.out, "transactions-preview.json")
    with open(path, "w") as fh:
        json.dump(out, fh)
    kb = os.path.getsize(path) / 1024
    print(f"wrote {path}  ({kb:.1f} KB, {len(rows)} rows, {len(keep)} cols, "
          f"{len(picks)} merchants across {len(seen_fam)} families)")


if __name__ == "__main__":
    main()
