"""Generate the synthetic merchant/transaction portfolio (offline analogue).

Deterministic from config.SEED. Writes three artifacts to scripts/artifacts/:
  - merchants.parquet (or .csv fallback): one row per merchant + ground truth
  - transactions.parquet: one row per transaction (synthetic card tokens only)
  - features.parquet: engineered per-merchant feature matrix

NO real PII, card numbers, merchants, or proprietary data. Card identifiers are
synthetic tokens ("C-000001"); no PANs are ever generated.

Usage:  python3 scripts/generate_synthetic_data.py
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    SEED, N_MERCHANTS, TARGET_TRANSACTIONS, WINDOW_DAYS, ABUSE_PREVALENCE,
    MONITORING_THRESHOLD, MCC_PROFILES, TYPOLOGIES, ARTIFACT_DIR,
)
from build_demo_scenarios import SCENARIOS, SCENARIO_IDS, ground_truth_flag

RNG = np.random.default_rng(SEED)
MCC_CODES = list(MCC_PROFILES.keys())


def _save(df: pd.DataFrame, name: str) -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        df.to_parquet(ARTIFACT_DIR / f"{name}.parquet", index=False)
    except Exception:  # pyarrow not installed — CSV is a fine fallback
        df.to_csv(ARTIFACT_DIR / f"{name}.csv", index=False)


def build_merchants() -> pd.DataFrame:
    rows = []

    # 1) Fixed showcase scenarios first, so their IDs are stable.
    for s in SCENARIOS:
        rows.append({
            "merchant_id": s.merchant_id,
            "declared_mcc": s.declared_mcc,
            "behavior_mcc": s.actual_mcc,
            "ground_truth_abuse": ground_truth_flag(s),
            "ground_truth_typology": s.primary_typology if ground_truth_flag(s) else "CLEAN",
            "threshold_avoid": s.threshold_avoid,
            "round_dollar": s.round_dollar,
            "wallet_load": s.wallet_load,
            "refund_after": s.refund_after,
            "cold_start": s.cold_start,
            "is_scenario": True,
        })

    # 2) Background population.
    n_bg = N_MERCHANTS - len(SCENARIOS)
    for i in range(n_bg):
        declared = MCC_CODES[RNG.integers(len(MCC_CODES))]
        abusive = RNG.random() < ABUSE_PREVALENCE
        if abusive:
            # Behavior resembles a *different*, higher-cash category.
            behavior = MCC_CODES[RNG.integers(len(MCC_CODES))]
            typ = TYPOLOGIES[RNG.integers(len(TYPOLOGIES))]
        else:
            behavior = declared
            typ = "CLEAN"
        rows.append({
            "merchant_id": f"M-{i:05d}",
            "declared_mcc": declared,
            "behavior_mcc": behavior,
            "ground_truth_abuse": bool(abusive),
            "ground_truth_typology": typ,
            "threshold_avoid": 0.5 if abusive and typ == "SPLIT_TICKETING" else 0.0,
            "round_dollar": 0.4 if abusive and typ == "CASH_DISBURSEMENT" else 0.0,
            "wallet_load": 0.5 if abusive and typ == "CASH_DISBURSEMENT" else 0.0,
            "refund_after": 0.3 if abusive and typ == "CASH_DISBURSEMENT" else 0.0,
            "cold_start": False,
            "is_scenario": False,
        })

    return pd.DataFrame(rows)


def build_transactions(merchants: pd.DataFrame) -> pd.DataFrame:
    # Allocate transaction counts per merchant (cold-start merchants get few).
    weights = np.where(merchants["cold_start"].to_numpy(), 0.05, 1.0)
    weights = weights / weights.sum()
    counts = RNG.multinomial(TARGET_TRANSACTIONS, weights)

    chunks = []
    for m, n in zip(merchants.itertuples(index=False), counts):
        if n == 0:
            continue
        prof = MCC_PROFILES[m.behavior_mcc]
        # Ticket amounts: lognormal around the profile's average ticket.
        mu = np.log(max(prof["ticket"], 1.0))
        amounts = RNG.lognormal(mean=mu, sigma=0.6, size=n)

        # Split-ticketing: pull a fraction just under the monitoring threshold.
        if m.threshold_avoid > 0:
            k = int(n * m.threshold_avoid)
            if k:
                amounts[:k] = MONITORING_THRESHOLD * RNG.uniform(0.90, 0.995, size=k)

        # Cash-disbursement: round-dollar wallet loads.
        if m.round_dollar > 0:
            k = int(n * m.round_dollar)
            if k:
                amounts[:k] = RNG.choice([50, 100, 200, 500], size=k)

        cash_flag = RNG.random(n) < prof["cash"]
        cp_flag = RNG.random(n) < prof["cp"]
        refund_flag = RNG.random(n) < max(prof["refund"], m.refund_after * 0.3)
        cards = RNG.integers(0, 300_000, size=n)  # synthetic token indices, not PANs

        chunks.append(pd.DataFrame({
            "merchant_id": m.merchant_id,
            "amount": np.round(amounts, 2),
            "is_cash_equiv": cash_flag,
            "is_card_present": cp_flag,
            "is_refund": refund_flag,
            "card_id": [f"C-{c:06d}" for c in cards],
        }))

    return pd.concat(chunks, ignore_index=True)


def build_features(merchants: pd.DataFrame, txns: pd.DataFrame) -> pd.DataFrame:
    g = txns.groupby("merchant_id")
    feat = pd.DataFrame({
        "merchant_id": g.size().index,
        "txn_count": g.size().to_numpy(),
        "avg_ticket": g["amount"].mean().to_numpy(),
        "std_ticket": g["amount"].std().fillna(0).to_numpy(),
        "cash_share": g["is_cash_equiv"].mean().to_numpy(),
        "card_present_share": g["is_card_present"].mean().to_numpy(),
        "refund_rate": g["is_refund"].mean().to_numpy(),
    })
    # Threshold-proximity: fraction of tickets within 10% below the threshold.
    near = txns.assign(
        near=(txns["amount"] >= MONITORING_THRESHOLD * 0.9)
        & (txns["amount"] < MONITORING_THRESHOLD)
    ).groupby("merchant_id")["near"].mean()
    feat = feat.merge(near.rename("threshold_proximity"), on="merchant_id", how="left")
    feat = feat.merge(
        merchants[["merchant_id", "declared_mcc", "behavior_mcc",
                   "ground_truth_abuse", "ground_truth_typology"]],
        on="merchant_id", how="left",
    )
    return feat


def main() -> None:
    print(f"[generate] seed={SEED}  target_txns={TARGET_TRANSACTIONS:,}")
    merchants = build_merchants()
    print(f"[generate] merchants: {len(merchants):,} "
          f"({merchants['ground_truth_abuse'].sum():,} abusive)")
    txns = build_transactions(merchants)
    print(f"[generate] transactions: {len(txns):,}")
    features = build_features(merchants, txns)
    print(f"[generate] features: {features.shape}")

    _save(merchants, "merchants")
    _save(txns, "transactions")
    _save(features, "features")
    print(f"[generate] wrote artifacts to {ARTIFACT_DIR}")

    assert len(txns) >= 100_000, "acceptance criterion: >= 100k transactions"
    assert (txns["card_id"].str.match(r"^C-\d{6}$")).all(), "synthetic card tokens only"
    print("[generate] OK — >=100k synthetic transactions, no real PANs.")


if __name__ == "__main__":
    main()
