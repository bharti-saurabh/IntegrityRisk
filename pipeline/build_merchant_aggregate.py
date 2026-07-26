#!/usr/bin/env python3
"""
build_merchant_aggregate.py
---------------------------
Takes the raw transaction-level settlement file and produces the merchant-level
scored table that the Integrity Risk demo sits on top of.

Pipeline
    1  load raw transactions + merchant dimensions
    2  activity filter (default: at least 3 transactions in the trailing 12 months)
    3  merchant-level feature build, ~80 features across nine families
    4  peer normalisation inside the declared MCC group
    5  per-category risk scores (gambling, adult, pharma, crypto_cash,
       nutra_subscription, tobacco_vape, dating_escort, cyberlocker,
       game_of_skill, financial_trading, telemarketing) plus pattern scores
       (mcc_miscoding, split_ticketing, factoring, descriptor, mcc_abuse,
       cash_disbursement)
    6  tiering, flagging, and rollups to DBA and CORP level

Outputs
    merchant_features.csv       every merchant that passes the activity filter
    merchant_scores.csv         features + scores + tier + flags
    flagged_merchants.csv       the investigation queue
    dba_rollup.csv / corp_rollup.csv
    filter_audit.csv            what the activity filter removed and why

Usage
    python build_merchant_aggregate.py --data ./data --out ./data
    python build_merchant_aggregate.py --data ./data --min-txn 3 --lookback-months 12
"""

import argparse
import os
import re
import numpy as np
import pandas as pd

from reference_data import (MCC_TABLE, INTEGRITY_CATEGORIES, OFFSHORE_ACQ,
                            INTERCHANGE_BPS_BY_GROUP, INTERCHANGE_BPS_DEFAULT)

SPLIT_CEILINGS = [100.0, 250.0, 500.0, 1000.0, 2500.0]
GENERIC_TOKENS = {"ONLINE", "PURCHASE", "WEB", "PAYMENT", "MERCHANT", "SERVICES",
                  "SVC", "DIGITAL", "SVCS", "ECOM", "PMT", "CUSTOMER", "SERVICE",
                  "BILLING", "DEPT", "SUBSCRIPTION", "HELP", "SUPPORT", "BILL"}


# --------------------------------------------------------------------------
def load(data_dir):
    tx_path_csv = os.path.join(data_dir, "raw_transactions.csv")
    tx_path_gz = tx_path_csv + ".gz"
    tx_path_pq = os.path.join(data_dir, "raw_transactions.parquet")
    if os.path.exists(tx_path_pq):
        tx = pd.read_parquet(tx_path_pq)
    elif os.path.exists(tx_path_csv):
        tx = pd.read_csv(tx_path_csv, low_memory=False)
    else:
        tx = pd.read_csv(tx_path_gz, low_memory=False)
    dim = pd.read_csv(os.path.join(data_dir, "dim_merchant.csv"))
    dba = pd.read_csv(os.path.join(data_dir, "dim_dba.csv"))
    corp = pd.read_csv(os.path.join(data_dir, "dim_corp.csv"))
    acc = pd.read_csv(os.path.join(data_dir, "dim_acceptance.csv"))
    tx["transaction_datetime_utc"] = pd.to_datetime(tx["transaction_datetime_utc"])
    tx["transaction_date"] = pd.to_datetime(tx["transaction_date"])
    for c in ("merchant_descriptor", "sub_merchant_id", "split_group_id",
              "chargeback_reason_code", "wallet_provider"):
        tx[c] = tx[c].fillna("").astype(str)
    return tx, dim, dba, corp, acc


# --------------------------------------------------------------------------
def activity_filter(tx, min_txn=3, lookback_months=12):
    """Remove merchants that are effectively dormant. Returns (kept_tx, audit)."""
    asof = tx["transaction_date"].max()
    cutoff = asof - pd.DateOffset(months=lookback_months)
    recent = tx[tx["transaction_date"] > cutoff]

    g = recent.groupby("merchant_id")
    audit = pd.DataFrame({
        "txn_count_lookback": g.size(),
        "approved_count_lookback": g["approved_flag"].apply(lambda s: (s == "Y").sum()),
        "sales_usd_lookback": g["settlement_amount_usd"].sum(),
        "first_txn": g["transaction_date"].min(),
        "last_txn": g["transaction_date"].max(),
    }).reset_index()
    audit["active_days"] = (audit["last_txn"] - audit["first_txn"]).dt.days + 1
    audit["days_since_last_txn"] = (asof - audit["last_txn"]).dt.days

    # merchants that appear in the file but have nothing in the lookback window
    missing = set(tx["merchant_id"].unique()) - set(audit["merchant_id"])
    if missing:
        audit = pd.concat([audit, pd.DataFrame({
            "merchant_id": sorted(missing), "txn_count_lookback": 0,
            "approved_count_lookback": 0, "sales_usd_lookback": 0.0,
            "active_days": 0, "days_since_last_txn": 999})], ignore_index=True)

    audit["passes_activity_filter"] = audit["txn_count_lookback"] >= min_txn
    audit["exclusion_reason"] = np.where(
        audit["passes_activity_filter"], "",
        "fewer than %d transactions in trailing %d months" % (min_txn, lookback_months))
    # second gate: no approved volume at all
    dead = (~audit["passes_activity_filter"]) | (audit["approved_count_lookback"] == 0)
    audit.loc[(audit["approved_count_lookback"] == 0) & audit["passes_activity_filter"],
              "exclusion_reason"] = "no approved transactions in lookback window"
    audit["passes_activity_filter"] = ~dead

    keep = set(audit.loc[audit["passes_activity_filter"], "merchant_id"])
    return recent[recent["merchant_id"].isin(keep)].copy(), audit


# --------------------------------------------------------------------------
def _entropy(counts):
    p = counts / counts.sum()
    p = p[p > 0]
    return float(-(p * np.log(p)).sum())


def _hhi(counts):
    p = counts / counts.sum()
    return float((p ** 2).sum())


def _tokens(s):
    return set(t for t in re.split(r"[^A-Z0-9]+", str(s).upper()) if len(t) > 2)


# --------------------------------------------------------------------------
def build_features(tx, dim, acc):
    tx = tx.copy()
    tx["approved"] = (tx["approved_flag"] == "Y").astype(int)
    tx["is_cnp"] = (tx["card_present_flag"] == "N").astype(int)
    tx["is_ecom"] = (tx["channel"] == "ECOMMERCE").astype(int)
    tx["is_moto"] = (tx["channel"] == "MOTO").astype(int)
    tx["is_recur"] = (tx["channel"] == "RECURRING").astype(int)
    tx["is_keyed"] = (tx["pos_entry_mode"] == "01").astype(int)
    tx["is_chip"] = tx["pos_entry_mode"].isin(["05", "07", "91"]).astype(int)
    tx["is_token"] = (tx["token_flag"] == "Y").astype(int)
    tx["is_xb"] = (tx["domestic_xborder_flag"] == "CROSS_BORDER").astype(int)
    tx["is_night"] = tx["local_hour"].isin([22, 23, 0, 1, 2, 3, 4, 5]).astype(int)
    tx["is_weekend"] = tx["transaction_datetime_utc"].dt.dayofweek.isin([5, 6]).astype(int)
    tx["is_refund"] = (tx["refund_flag"] == "Y").astype(int)
    tx["is_reversal"] = (tx["reversal_flag"] == "Y").astype(int)
    tx["is_cb"] = (tx["chargeback_flag"] == "Y").astype(int)
    tx["is_fraud"] = (tx["fraud_flag"] == "Y").astype(int)
    tx["is_quasi_cash"] = tx["transaction_type_code"].isin(["01", "11"]).astype(int)
    tx["is_3ds"] = (tx["three_ds_flag"] == "Y").astype(int)
    tx["abs_amt"] = tx["settlement_amount_usd"].abs()
    tx["is_round"] = ((tx["abs_amt"] % 10 == 0) & (tx["abs_amt"] > 0)).astype(int)
    tx["is_round_100"] = ((tx["abs_amt"] % 100 == 0) & (tx["abs_amt"] > 0)).astype(int)
    tx["cb_fraud_reason"] = tx["chargeback_reason_code"].str.startswith("10.").astype(int)
    tx["cb_service_reason"] = tx["chargeback_reason_code"].str.startswith("13.").astype(int)
    tx["decline_57_62_93"] = tx["auth_response_code"].isin(["57", "62", "93"]).astype(int)
    tx["decline_59"] = (tx["auth_response_code"] == "59").astype(int)
    tx["decline_61_65"] = tx["auth_response_code"].isin(["61", "65"]).astype(int)
    tx["month"] = tx["transaction_date"].dt.to_period("M").astype(str)

    # amounts sitting just under a common floor-limit style ceiling
    near = np.zeros(len(tx), dtype=int)
    for c in SPLIT_CEILINGS:
        near |= ((tx["abs_amt"] >= c * 0.85) & (tx["abs_amt"] < c)).astype(int).values
    tx["near_ceiling"] = near

    appr = tx[tx["approved"] == 1]
    g = tx.groupby("merchant_id")
    ga = appr.groupby("merchant_id")

    f = pd.DataFrame(index=g.size().index)
    f.index.name = "merchant_id"

    # ---- volume ------------------------------------------------------------
    f["txn_count"] = g.size()
    f["approved_txn_count"] = ga.size().reindex(f.index).fillna(0)
    f["sales_usd"] = ga["settlement_amount_usd"].sum().reindex(f.index).fillna(0)
    f["gross_sales_usd"] = ga.apply(
        lambda d: d.loc[d.is_refund == 0, "abs_amt"].sum(), include_groups=False
    ).reindex(f.index).fillna(0)
    f["refund_usd"] = ga.apply(
        lambda d: d.loc[d.is_refund == 1, "abs_amt"].sum(), include_groups=False
    ).reindex(f.index).fillna(0)
    f["avg_ticket_usd"] = ga["abs_amt"].mean().reindex(f.index).fillna(0)
    f["median_ticket_usd"] = ga["abs_amt"].median().reindex(f.index).fillna(0)
    f["p95_ticket_usd"] = ga["abs_amt"].quantile(0.95).reindex(f.index).fillna(0)
    f["max_ticket_usd"] = ga["abs_amt"].max().reindex(f.index).fillna(0)
    f["ticket_std_usd"] = ga["abs_amt"].std().reindex(f.index).fillna(0)
    f["ticket_cv"] = f["ticket_std_usd"] / f["avg_ticket_usd"].replace(0, np.nan)

    # ---- tenure / cadence ---------------------------------------------------
    f["first_txn_date"] = g["transaction_date"].min()
    f["last_txn_date"] = g["transaction_date"].max()
    f["active_days"] = (f["last_txn_date"] - f["first_txn_date"]).dt.days + 1
    f["distinct_active_days"] = g["transaction_date"].nunique()
    f["txn_per_active_day"] = f["txn_count"] / f["distinct_active_days"].replace(0, np.nan)
    f["active_months"] = g["month"].nunique()

    # ---- channel mix --------------------------------------------------------
    for col, name in [("is_cnp", "pct_cnp"), ("is_ecom", "pct_ecom"), ("is_moto", "pct_moto"),
                      ("is_recur", "pct_recurring"), ("is_keyed", "pct_keyed"),
                      ("is_chip", "pct_chip"), ("is_token", "pct_token"),
                      ("is_3ds", "pct_3ds"), ("is_quasi_cash", "pct_quasi_cash")]:
        f[name] = g[col].mean()

    # ---- geography ----------------------------------------------------------
    f["pct_cross_border"] = g["is_xb"].mean()
    f["n_issuer_countries"] = g["issuer_country"].nunique()
    f["n_issuer_bins"] = g["issuer_bin"].nunique()
    ic = tx.groupby(["merchant_id", "issuer_country"]).size()
    f["issuer_country_hhi"] = ic.groupby("merchant_id").apply(lambda s: _hhi(s.values))
    f["issuer_country_entropy"] = ic.groupby("merchant_id").apply(lambda s: _entropy(s.values))
    f["top_issuer_country_share"] = ic.groupby("merchant_id").apply(lambda s: s.max() / s.sum())
    f["pct_acq_country_mismatch"] = (
        g["merchant_acquirer_country_mismatch"].apply(lambda s: (s == "Y").mean()))
    f["n_acquirer_bins"] = g["acquirer_bin"].nunique()
    f["n_caids"] = g["card_acceptor_id"].nunique()
    f["pct_offshore_acquirer"] = g["acquirer_country"].apply(
        lambda s: s.isin(OFFSHORE_ACQ).mean())

    # ---- timing -------------------------------------------------------------
    f["pct_night_txn"] = g["is_night"].mean()
    f["pct_weekend_txn"] = g["is_weekend"].mean()
    hh = tx.groupby(["merchant_id", "local_hour"]).size()
    f["hour_entropy"] = hh.groupby("merchant_id").apply(lambda s: _entropy(s.values))

    # ---- ticket shape -------------------------------------------------------
    f["pct_round_amount"] = g["is_round"].mean()
    f["pct_round_100"] = g["is_round_100"].mean()
    f["pct_near_ceiling"] = g["near_ceiling"].mean()
    f["pct_ticket_gt_500"] = g["abs_amt"].apply(lambda s: (s > 500).mean())
    f["pct_ticket_lt_20"] = g["abs_amt"].apply(lambda s: (s < 20).mean())
    f["distinct_amount_ratio"] = g["abs_amt"].nunique() / f["txn_count"]

    # ---- authorisation quality ----------------------------------------------
    f["approval_rate"] = g["approved"].mean()
    f["decline_rate"] = 1 - f["approval_rate"]
    f["pct_decline_not_permitted"] = g["decline_57_62_93"].mean()
    f["pct_decline_suspected_fraud"] = g["decline_59"].mean()
    f["pct_decline_limit"] = g["decline_61_65"].mean()
    dc = tx[tx.approved == 0].groupby(["merchant_id", "auth_response_code"]).size()
    f["decline_code_entropy"] = dc.groupby("merchant_id").apply(
        lambda s: _entropy(s.values)).reindex(f.index).fillna(0)

    # ---- refunds, disputes, fraud --------------------------------------------
    f["refund_rate_count"] = g["is_refund"].mean()
    f["refund_rate_amount"] = f["refund_usd"] / f["gross_sales_usd"].replace(0, np.nan)
    f["reversal_rate"] = g["is_reversal"].mean()
    f["chargeback_rate_bps"] = g["is_cb"].mean() * 10000
    f["fraud_rate_bps"] = g["is_fraud"].mean() * 10000
    f["fraud_usd"] = g["fraud_amount_usd"].sum()
    f["fraud_to_sales_bps"] = f["fraud_usd"] / f["gross_sales_usd"].replace(0, np.nan) * 10000
    f["cb_usd"] = g["chargeback_amount_usd"].sum()
    f["cb_to_sales_bps"] = f["cb_usd"] / f["gross_sales_usd"].replace(0, np.nan) * 10000
    f["pct_cb_fraud_reason"] = g["cb_fraud_reason"].mean()
    f["pct_cb_service_reason"] = g["cb_service_reason"].mean()

    # ---- card behaviour -------------------------------------------------------
    f["unique_cards"] = g["card_token_id"].nunique()
    f["txn_per_card"] = f["txn_count"] / f["unique_cards"].replace(0, np.nan)
    cc = tx.groupby(["merchant_id", "card_token_id"]).size()
    f["pct_cards_multi_use"] = cc.groupby("merchant_id").apply(lambda s: (s > 1).mean())
    f["max_txn_single_card"] = cc.groupby("merchant_id").max()
    f["card_concentration_hhi"] = cc.groupby("merchant_id").apply(lambda s: _hhi(s.values))

    # ---- velocity / spike ------------------------------------------------------
    dm = tx.groupby(["merchant_id", "month"])["abs_amt"].sum()
    f["max_month_sales_usd"] = dm.groupby("merchant_id").max()
    f["median_month_sales_usd"] = dm.groupby("merchant_id").median()
    f["volume_spike_ratio"] = (f["max_month_sales_usd"] /
                               f["median_month_sales_usd"].replace(0, np.nan))
    f["pct_sales_in_top_month"] = (f["max_month_sales_usd"] /
                                   dm.groupby("merchant_id").sum().replace(0, np.nan))
    mom = dm.groupby("merchant_id").apply(
        lambda s: float(np.nanmax(np.diff(s.values) / np.maximum(s.values[:-1], 1)))
        if len(s) > 1 else 0.0)
    f["max_mom_growth"] = mom

    # ---- split ticketing ---------------------------------------------------------
    st = tx.sort_values(["merchant_id", "card_token_id", "transaction_datetime_utc"])
    st["gap_sec"] = (st.groupby(["merchant_id", "card_token_id"])["transaction_datetime_utc"]
                     .diff().dt.total_seconds())
    st["new_burst"] = ((st["gap_sec"].isna()) | (st["gap_sec"] > 3600)).astype(int)
    st["burst_id"] = st.groupby(["merchant_id", "card_token_id"])["new_burst"].cumsum()
    bursts = (st.groupby(["merchant_id", "card_token_id", "burst_id"])
                .agg(n=("abs_amt", "size"), amt_mean=("abs_amt", "mean"),
                     amt_std=("abs_amt", "std"), span=("gap_sec", "sum"),
                     near=("near_ceiling", "mean")).reset_index())
    bursts["amt_cv"] = bursts["amt_std"] / bursts["amt_mean"].replace(0, np.nan)
    sig = bursts[(bursts["n"] >= 3) & (bursts["amt_cv"].fillna(0) < 0.20)]
    bg = sig.groupby("merchant_id")
    f["split_burst_events"] = bg.size().reindex(f.index).fillna(0)
    f["split_txn_count"] = bg["n"].sum().reindex(f.index).fillna(0)
    f["pct_txn_in_split_burst"] = f["split_txn_count"] / f["txn_count"]
    f["mean_split_burst_size"] = bg["n"].mean().reindex(f.index).fillna(0)
    f["mean_split_gap_sec"] = (bg["span"].mean() / bg["n"].mean()).reindex(f.index).fillna(0)
    f["pct_split_near_ceiling"] = bg["near"].mean().reindex(f.index).fillna(0)

    # ---- descriptor intelligence -----------------------------------------------
    f["n_distinct_descriptors"] = g["merchant_descriptor"].nunique()
    f["n_sub_merchant_ids"] = g["sub_merchant_id"].apply(lambda s: s[s != ""].nunique())
    f["pct_txn_with_sub_merchant"] = g["sub_merchant_id"].apply(lambda s: (s != "").mean())
    desc_by_m = g["merchant_descriptor"].apply(lambda s: list(s.unique()))
    f["pct_generic_descriptor"] = g["merchant_descriptor"].apply(
        lambda s: s.apply(lambda d: len(_tokens(d) & GENERIC_TOKENS) > 0).mean())
    f["has_url_descriptor"] = desc_by_m.apply(
        lambda lst: int(any(("WWW." in d) or (".COM" in d) for d in lst)))
    dmonth = tx.groupby(["merchant_id", "month"])["merchant_descriptor"].agg(
        lambda s: s.mode().iat[0] if len(s) else "")
    f["descriptor_changes"] = dmonth.groupby("merchant_id").apply(
        lambda s: int((s != s.shift()).sum() - 1))

    name_map = dim.set_index("merchant_id")[["dba_id", "corp_id", "merchant_name",
                                             "declared_mcc", "merchant_country",
                                             "merchant_city"]]
    dba_names = dim.set_index("merchant_id")["merchant_name"]
    overlap = {}
    for mid, lst in desc_by_m.items():
        nm = _tokens(dba_names.get(mid, ""))
        if not nm:
            overlap[mid] = 0.0
            continue
        best = 0.0
        for d in lst:
            dt = _tokens(d)
            if not dt:
                continue
            best = max(best, len(nm & dt) / len(nm | dt))
        overlap[mid] = best
    f["descriptor_name_jaccard"] = pd.Series(overlap).reindex(f.index).fillna(0)

    # ---- MCC coherence ------------------------------------------------------------
    f = f.join(name_map, how="left")
    f["mcc_group"] = f["declared_mcc"].astype(str).str.zfill(4).map(
        lambda m: MCC_TABLE.get(m, ("", "UNKNOWN"))[1])
    f["mcc_expected_avg_ticket"] = f["declared_mcc"].astype(str).str.zfill(4).map(
        lambda m: MCC_TABLE.get(m, ("", "", 50.0))[2])
    f["mcc_expected_cnp_share"] = f["declared_mcc"].astype(str).str.zfill(4).map(
        lambda m: MCC_TABLE.get(m, ("", "", 0, 0.3))[3])
    f["mcc_expected_night_share"] = f["declared_mcc"].astype(str).str.zfill(4).map(
        lambda m: MCC_TABLE.get(m, ("", "", 0, 0, 0.12))[4])
    f["ticket_vs_mcc_expected"] = f["avg_ticket_usd"] / f["mcc_expected_avg_ticket"]
    f["cnp_vs_mcc_expected"] = f["pct_cnp"] - f["mcc_expected_cnp_share"]
    f["night_vs_mcc_expected"] = f["pct_night_txn"] - f["mcc_expected_night_share"]

    # ---- interchange coherence (MCC-abuse signal) ---------------------------------
    # What the merchant actually pays, in basis points of settled sales.
    f["interchange_fee_usd"] = ga["interchange_fee_usd"].sum().reindex(f.index).fillna(0)
    f["effective_interchange_bps"] = (
        f["interchange_fee_usd"] / f["sales_usd"].replace(0, np.nan) * 10000)
    # The band a compliant merchant in the DECLARED category would pay.
    f["mcc_declared_interchange_bps"] = f["mcc_group"].map(
        lambda gname: INTERCHANGE_BPS_BY_GROUP.get(gname, INTERCHANGE_BPS_DEFAULT))
    # The band this merchant's BEHAVIOUR (channel mix) would ordinarily warrant: a
    # card-present staple sits ~130 bps, a fully card-not-present profile ~250 bps.
    f["behaviour_expected_interchange_bps"] = 130.0 + f["pct_cnp"].clip(0, 1) * 120.0
    # Positive gap = paying materially less interchange than the behaviour implies,
    # i.e. coded into a cheaper band than the way it transacts would warrant.
    f["interchange_advantage_bps"] = (
        f["behaviour_expected_interchange_bps"] - f["effective_interchange_bps"])
    f["declared_band_is_cheap"] = (f["mcc_declared_interchange_bps"] <= 160).astype(int)

    return f.reset_index()


# --------------------------------------------------------------------------
def peer_zscores(f, cols, peer_col="mcc_group", min_peers=25):
    """Z-score each column inside its declared-MCC peer group, global fallback."""
    z = pd.DataFrame(index=f.index)
    for c in cols:
        v = pd.to_numeric(f[c], errors="coerce")
        grp = f[peer_col]
        mu = v.groupby(grp).transform("mean")
        sd = v.groupby(grp).transform("std")
        cnt = v.groupby(grp).transform("count")
        gmu, gsd = v.mean(), v.std()
        mu = mu.where(cnt >= min_peers, gmu)
        sd = sd.where(cnt >= min_peers, gsd)
        z["z_" + c] = ((v - mu) / sd.replace(0, np.nan)).fillna(0).clip(-5, 5)
    return z


def logistic_score(x, k=1.0):
    return 100.0 / (1.0 + np.exp(-k * x))


CATEGORY_WEIGHTS = {
    "gambling": {
        "z_pct_night_txn": 1.4, "z_pct_round_amount": 1.5, "z_txn_per_card": 1.3,
        "z_pct_cnp": 0.9, "z_pct_cross_border": 1.0, "z_pct_decline_not_permitted": 1.6,
        "z_pct_offshore_acquirer": 1.1, "z_ticket_vs_mcc_expected": 0.7,
        "z_max_txn_single_card": 0.8, "z_pct_quasi_cash": 0.6, "z_hour_entropy": -0.5,
    },
    "adult": {
        "z_pct_cnp": 1.1, "z_pct_night_txn": 1.3, "z_pct_recurring": 1.2,
        "z_chargeback_rate_bps": 1.4, "z_refund_rate_count": 1.0,
        "z_descriptor_changes": 1.3, "z_pct_ticket_lt_20": 0.8,
        "z_pct_offshore_acquirer": 0.9, "z_descriptor_name_jaccard": -1.0,
    },
    "pharma": {
        "z_pct_recurring": 1.2, "z_pct_cross_border": 1.5, "z_chargeback_rate_bps": 1.2,
        "z_pct_cb_service_reason": 1.1, "z_refund_rate_count": 1.0,
        "z_issuer_country_entropy": 1.0, "z_descriptor_changes": 0.9,
        "z_pct_offshore_acquirer": 0.9, "z_pct_generic_descriptor": 0.7,
    },
    "crypto_cash": {
        "z_pct_quasi_cash": 2.0, "z_pct_round_100": 1.6, "z_avg_ticket_usd": 1.1,
        "z_txn_per_card": 1.2, "z_pct_decline_limit": 1.3, "z_pct_ticket_gt_500": 1.0,
        "z_ticket_vs_mcc_expected": 1.2, "z_pct_offshore_acquirer": 0.8,
        "z_distinct_amount_ratio": -0.9,
    },
    "nutra_subscription": {
        "z_pct_recurring": 1.9, "z_pct_cb_service_reason": 1.5,
        "z_chargeback_rate_bps": 1.4, "z_refund_rate_count": 1.3,
        "z_descriptor_changes": 1.1, "z_decline_rate": 1.0,
        "z_pct_generic_descriptor": 0.9, "z_descriptor_name_jaccard": -0.8,
    },
    "tobacco_vape": {
        "z_pct_cnp": 0.8, "z_pct_night_txn": 0.9, "z_chargeback_rate_bps": 0.9,
        "z_pct_cross_border": 0.8, "z_ticket_vs_mcc_expected": 0.7,
        "z_pct_decline_not_permitted": 0.9,
    },
    # P1 — dating & escort (behaves like 7273): adult-adjacent but night- and CNP-heavier
    "dating_escort": {
        "z_pct_cnp": 1.2, "z_pct_night_txn": 1.5, "z_pct_recurring": 1.0,
        "z_chargeback_rate_bps": 1.3, "z_refund_rate_count": 1.0,
        "z_descriptor_changes": 1.2, "z_cnp_vs_mcc_expected": 1.1,
        "z_pct_offshore_acquirer": 0.9, "z_descriptor_name_jaccard": -1.0,
    },
    # P2 — cyberlockers / file-host subscriptions: negative-option recurring + cancel disputes
    "cyberlocker": {
        "z_pct_recurring": 1.9, "z_pct_cb_service_reason": 1.6,
        "z_chargeback_rate_bps": 1.4, "z_refund_rate_count": 1.3,
        "z_decline_rate": 1.1, "z_pct_ticket_lt_20": 0.9,
        "z_pct_generic_descriptor": 0.9, "z_descriptor_name_jaccard": -0.8,
    },
    # P2 — game of skill (behaves like 7995): gambling-adjacent, softer signature
    "game_of_skill": {
        "z_pct_round_amount": 1.4, "z_pct_night_txn": 1.1, "z_txn_per_card": 1.3,
        "z_pct_cross_border": 1.0, "z_max_txn_single_card": 0.9,
        "z_pct_decline_not_permitted": 1.2, "z_pct_quasi_cash": 0.7,
        "z_ticket_vs_mcc_expected": 0.7,
    },
    # P3 — unlicensed financial trading / FX-CFD (behaves like 6211): big round tickets, declines
    "financial_trading": {
        "z_ticket_vs_mcc_expected": 1.5, "z_pct_ticket_gt_500": 1.4,
        "z_pct_round_100": 1.3, "z_pct_cross_border": 1.4, "z_pct_cnp": 1.0,
        "z_pct_decline_limit": 1.2, "z_pct_offshore_acquirer": 1.1,
        "z_avg_ticket_usd": 1.0,
    },
    # P3 — outbound telemarketing / continuity (behaves like 5966): MOTO + keyed, service disputes
    "telemarketing": {
        "z_pct_cnp": 1.0, "z_pct_keyed": 1.4, "z_pct_moto": 1.2,
        "z_pct_recurring": 1.1, "z_pct_cb_service_reason": 1.4,
        "z_refund_rate_count": 1.1, "z_descriptor_changes": 0.9,
        "z_cnp_vs_mcc_expected": 1.0,
    },
}

PATTERN_WEIGHTS = {
    "mcc_miscoding": {
        "z_cnp_vs_mcc_expected": 1.4, "z_night_vs_mcc_expected": 1.4,
        "z_ticket_vs_mcc_expected": 1.0, "z_pct_round_amount": 1.1,
        "z_pct_cross_border": 0.9, "z_pct_decline_not_permitted": 1.3,
        "z_txn_per_card": 0.9, "z_pct_offshore_acquirer": 0.8,
    },
    "split_ticketing": {
        "z_pct_txn_in_split_burst": 2.2, "z_split_burst_events": 1.3,
        "z_pct_near_ceiling": 1.6, "z_mean_split_burst_size": 0.9,
        "z_pct_cards_multi_use": 0.8, "z_mean_split_gap_sec": -0.7,
    },
    "factoring": {
        "z_n_sub_merchant_ids": 1.7, "z_volume_spike_ratio": 1.5,
        "z_max_mom_growth": 1.2, "z_n_distinct_descriptors": 1.2,
        "z_pct_generic_descriptor": 1.1, "z_ticket_cv": 1.0,
        "z_issuer_country_entropy": 0.9, "z_descriptor_name_jaccard": -1.2,
    },
    "descriptor": {
        "z_descriptor_changes": 1.8, "z_n_distinct_descriptors": 1.5,
        "z_pct_generic_descriptor": 1.3, "z_has_url_descriptor": 0.8,
        "z_descriptor_name_jaccard": -1.6,
    },
    # MCC abuse for interchange advantage: content is not prohibited, but the merchant
    # is coded into a cheaper interchange band than its behaviour warrants. The tell is a
    # large positive interchange advantage sitting on top of a card-not-present profile
    # inside a category (grocery / fuel / charity) that should be card-present.
    "mcc_abuse": {
        "z_interchange_advantage_bps": 2.0, "z_cnp_vs_mcc_expected": 1.6,
        "z_declared_band_is_cheap": 1.0, "z_pct_recurring": 0.7,
        "z_pct_token": 0.5, "z_effective_interchange_bps": -1.1,
        "z_chargeback_rate_bps": -0.4,
    },
    # Cash disbursement / factoring-for-cash: very round, high-ticket, repeat-card draws
    # against a merchant whose declared category is not a permitted cash outlet.
    "cash_disbursement": {
        "z_pct_round_100": 1.8, "z_avg_ticket_usd": 1.4, "z_pct_ticket_gt_500": 1.3,
        "z_txn_per_card": 1.2, "z_max_txn_single_card": 1.1,
        "z_pct_decline_limit": 1.0, "z_pct_quasi_cash": 0.9,
        "z_distinct_amount_ratio": -1.0,
    },
}


# The overall score is a single weighted combination, not the max of the category
# scores. Taking a max over many logistic scores inflates every merchant, because
# the largest of ten noisy draws is high even when nothing is wrong.
OVERALL_WEIGHTS = {
    "z_cnp_vs_mcc_expected": 1.2, "z_night_vs_mcc_expected": 1.2,
    "z_ticket_vs_mcc_expected": 0.7, "z_pct_round_amount": 1.0,
    "z_pct_cross_border": 0.9, "z_pct_offshore_acquirer": 1.3,
    "z_pct_decline_not_permitted": 1.7, "z_chargeback_rate_bps": 1.2,
    "z_refund_rate_count": 0.8, "z_txn_per_card": 0.9,
    "z_descriptor_changes": 1.1, "z_descriptor_name_jaccard": -1.0,
    "z_pct_generic_descriptor": 0.8, "z_pct_txn_in_split_burst": 1.1,
    "z_n_sub_merchant_ids": 1.0, "z_pct_quasi_cash": 1.0,
    "z_pct_recurring": 0.6, "z_volume_spike_ratio": 0.6,
    "z_pct_decline_suspected_fraud": 0.7,
}


def score(f):
    needed = sorted({c[2:] for w in list(CATEGORY_WEIGHTS.values()) +
                     list(PATTERN_WEIGHTS.values()) + [OVERALL_WEIGHTS] for c in w})
    for c in needed:
        if c not in f.columns:
            f[c] = 0.0
    z = peer_zscores(f, needed)
    out = f.copy()

    for name, w in {**CATEGORY_WEIGHTS, **PATTERN_WEIGHTS}.items():
        s = sum(z[c] * wt for c, wt in w.items())
        s = s / np.sqrt(sum(abs(v) for v in w.values()))
        out[f"score_{name}"] = np.round(logistic_score(s, k=1.35), 1)

    cat_cols = [f"score_{c}" for c in CATEGORY_WEIGHTS]
    pat_cols = [f"score_{c}" for c in PATTERN_WEIGHTS]
    out["top_category"] = out[cat_cols].idxmax(axis=1).str.replace("score_", "", regex=False)
    out["top_category_score"] = out[cat_cols].max(axis=1)
    out["top_pattern"] = out[pat_cols].idxmax(axis=1).str.replace("score_", "", regex=False)
    out["top_pattern_score"] = out[pat_cols].max(axis=1)

    comb = sum(z[c] * wt for c, wt in OVERALL_WEIGHTS.items())
    comb = comb / np.sqrt(sum(abs(v) for v in OVERALL_WEIGHTS.values()))
    out["integrity_composite_z"] = np.round(comb, 3)
    out["integrity_risk_score"] = np.round(logistic_score(comb, k=1.55), 1)
    out["integrity_percentile"] = np.round(
        out["integrity_risk_score"].rank(pct=True) * 100, 1)

    # exposure weighting: a big merchant at the same score matters more
    exp_w = np.log1p(out["gross_sales_usd"].clip(lower=0)) / \
        np.log1p(out["gross_sales_usd"].clip(lower=0)).max()
    out["exposure_weighted_score"] = np.round(
        out["integrity_risk_score"] * (0.7 + 0.3 * exp_w), 1)

    out["risk_tier"] = pd.cut(out["integrity_risk_score"],
                              bins=[-1, 60, 75, 85, 93, 101],
                              labels=["Low", "Monitor", "Elevated", "High", "Critical"])

    # ---- deterministic rule layer sitting alongside the score -----------------
    rules = []
    r1 = (out["pct_txn_in_split_burst"] > 0.10) & (out["pct_near_ceiling"] > 0.15)
    r2 = (out["n_sub_merchant_ids"] >= 2) & (out["volume_spike_ratio"] > 3)
    r3 = (out["descriptor_changes"] >= 3) & (out["descriptor_name_jaccard"] < 0.20)
    r4 = (out["pct_quasi_cash"] > 0.25) & (~out["declared_mcc"].astype(str).isin(
        ["6010", "6012", "6051", "6211", "7995"]))
    r5 = (out["pct_night_txn"] > 0.35) & (out["pct_round_amount"] > 0.30) & \
         (out["pct_cross_border"] > 0.30)
    r6 = (out["chargeback_rate_bps"] > 100) & (out["refund_rate_count"] > 0.05)
    r7 = (out["pct_decline_not_permitted"] > 0.05)
    # cash disbursement: very round, high-ticket, repeat-card draws in a non-cash category
    r8 = (out["pct_round_100"] > 0.40) & (out["avg_ticket_usd"] > 400) & \
         (out["pct_ticket_gt_500"] > 0.30) & (~out["declared_mcc"].astype(str).isin(
             ["6010", "6011", "6012", "6051", "6211", "7995"]))
    # interchange abuse — two flavours, both detectable from the aggregate:
    #   (a) coded into a genuinely cheap band (grocery / fuel / charity) while running a
    #       card-not-present profile that warrants a materially higher band; or
    #   (b) coded into a card-present category (e.g. restaurant) while transacting almost
    #       entirely card-not-present, a strong channel-vs-category mismatch.
    r9 = ((out["interchange_advantage_bps"] > 50) & (out["declared_band_is_cheap"] == 1)) | \
         ((out["cnp_vs_mcc_expected"] > 0.55) & (out["interchange_advantage_bps"] > 25))
    for name, mask in [("split_ticketing_rule", r1), ("factoring_rule", r2),
                       ("descriptor_churn_rule", r3), ("undeclared_quasi_cash_rule", r4),
                       ("gambling_behaviour_rule", r5), ("dispute_excursion_rule", r6),
                       ("issuer_prohibition_rule", r7), ("cash_disbursement_rule", r8),
                       ("interchange_abuse_rule", r9)]:
        out[name] = mask.fillna(False).astype(int)
        rules.append(name)
    out["rules_triggered"] = out[rules].sum(axis=1)
    out["rule_names"] = out[rules].apply(
        lambda r: "|".join([c for c in rules if r[c] == 1]), axis=1)

    # two independent routes into the queue: the model, and the deterministic rules
    out["flag_reason"] = np.where(
        (out["integrity_risk_score"] >= 85) & (out["rules_triggered"] >= 1),
        "model + rule",
        np.where(out["integrity_risk_score"] >= 85, "model",
                 np.where(out["rules_triggered"] >= 1, "rule", "")))
    out["flag_for_investigation"] = (out["flag_reason"] != "").astype(int)
    return out


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="./data")
    ap.add_argument("--out", default=None)
    ap.add_argument("--min-txn", type=int, default=3)
    ap.add_argument("--lookback-months", type=int, default=12)
    a = ap.parse_args()
    out_dir = a.out or a.data
    os.makedirs(out_dir, exist_ok=True)

    tx, dim, dba, corp, acc = load(a.data)
    print(f"loaded {len(tx):,} transactions, {tx.merchant_id.nunique():,} merchants")

    kept, audit = activity_filter(tx, a.min_txn, a.lookback_months)
    n_drop = int((~audit["passes_activity_filter"]).sum())
    print(f"activity filter removed {n_drop:,} merchants, "
          f"{audit['passes_activity_filter'].sum():,} remain")

    f = build_features(kept, dim, acc)
    print(f"built {f.shape[1]-1} features for {len(f):,} merchants")

    s = score(f)
    s = s.merge(dba[["dba_id", "dba_name"]], on="dba_id", how="left")
    s = s.merge(corp[["corp_id", "corp_name", "corp_country"]], on="corp_id", how="left")

    gt_path = os.path.join(a.data, "ground_truth_labels.csv")
    if os.path.exists(gt_path):
        gt = pd.read_csv(gt_path)
        gt_cols = ["merchant_id", "archetype", "integrity_category",
                   "is_integrity_violation"]
        for extra in ("integrity_tier", "is_interchange_abuse"):
            if extra in gt.columns:
                gt_cols.append(extra)
        s = s.merge(gt[gt_cols], on="merchant_id", how="left")

    f.to_csv(os.path.join(out_dir, "merchant_features.csv"), index=False)
    s.to_csv(os.path.join(out_dir, "merchant_scores.csv"), index=False)
    audit.to_csv(os.path.join(out_dir, "filter_audit.csv"), index=False)
    s[s.flag_for_investigation == 1].sort_values(
        "exposure_weighted_score", ascending=False).to_csv(
        os.path.join(out_dir, "flagged_merchants.csv"), index=False)

    agg = dict(merchants=("merchant_id", "nunique"), txns=("txn_count", "sum"),
               sales_usd=("gross_sales_usd", "sum"),
               max_score=("integrity_risk_score", "max"),
               mean_score=("integrity_risk_score", "mean"),
               flagged=("flag_for_investigation", "sum"))
    s.groupby(["dba_id", "dba_name"]).agg(**agg).reset_index().to_csv(
        os.path.join(out_dir, "dba_rollup.csv"), index=False)
    s.groupby(["corp_id", "corp_name"]).agg(**agg).reset_index().to_csv(
        os.path.join(out_dir, "corp_rollup.csv"), index=False)

    print("\nrisk tier distribution")
    print(s["risk_tier"].value_counts().sort_index().to_string())
    print(f"\nflagged for investigation: {int(s.flag_for_investigation.sum()):,}")
    if "is_integrity_violation" in s.columns:
        viol = s.is_integrity_violation.fillna(False)
        abuse = (s.is_interchange_abuse.fillna(False)
                 if "is_interchange_abuse" in s.columns
                 else pd.Series(False, index=s.index))
        flagged = s.flag_for_investigation == 1

        # The queue legitimately targets both integrity violations and interchange abuse,
        # so score precision against the union and report each class's recall separately.
        target = viol | abuse
        tp = int((flagged & target).sum())
        fp = int((flagged & ~target).sum())
        fn = int((~flagged & target).sum())
        print(f"against planted labels (violation + abuse)  "
              f"precision {tp / max(1, tp + fp):.2f}  recall {tp / max(1, tp + fn):.2f}  "
              f"(tp {tp} fp {fp} fn {fn})")

        v_rec = int((flagged & viol).sum()) / max(1, int(viol.sum()))
        print(f"  integrity-violation recall {v_rec:.2f}  "
              f"({int((flagged & viol).sum())}/{int(viol.sum())})")
        if abuse.any():
            a_rec = int((flagged & abuse).sum()) / max(1, int(abuse.sum()))
            print(f"  interchange-abuse recall   {a_rec:.2f}  "
                  f"({int((flagged & abuse).sum())}/{int(abuse.sum())})")
    print(f"\nwritten to {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    main()
