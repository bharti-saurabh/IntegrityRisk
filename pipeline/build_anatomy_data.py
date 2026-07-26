#!/usr/bin/env python3
"""
build_anatomy_data.py
---------------------
Builds the six-chapter "Anatomy of a Typology" scene deck data — one real
(synthetic) flagged exemplar per integrity family, plus a plain-English teaching
layer. Every number is the live pipeline's: peer z-scores are recomputed with the
same peer_zscores() the scorer uses; the composite decomposition is the actual
OVERALL_WEIGHTS contribution; sample transactions and per-family signature views
(interchange band, split bursts, sub-merchant fan-out, descriptor rotation, cash
histogram) are derived straight from raw_transactions.parquet. No PII, no PANs.

Honesty rules baked in (from model-risk review):
  * Only MCC Miscoding is model-routed; the other five are rule-routed. Each
    family emits its flag_reason so the deck can frame the score scene truthfully.
  * The content-classifier "fingerprint" is emitted ONLY for mcc_miscoding — for
    the others it would assert a content accusation the model never made.
  * Deviation features per family come from that family's own PATTERN_WEIGHTS.

Usage
    python build_anatomy_data.py \
        --data "../MCC Miscoding Data v2/data" \
        --out  "../src/data/anatomy.generated.json"
"""

import argparse
import json
import math
import os

import numpy as np
import pandas as pd

from build_merchant_aggregate import (
    peer_zscores, OVERALL_WEIGHTS, CATEGORY_WEIGHTS, PATTERN_WEIGHTS,
)
from build_web_artifacts import (
    primary_family, CATEGORY_TIER, CATEGORY_LABEL, FAMILY_LABEL,
)

P1_CATEGORIES = {"adult", "dating_escort", "gambling", "pharma"}
FAMILY_ORDER = ["mcc_miscoding", "mcc_abuse", "split_ticketing", "factoring", "descriptor", "cash"]

FAMILY_META = {  # mirror of the web FAMILY_META so the JSON is self-contained
    "mcc_miscoding":   {"color": "#2563eb", "icon": "Layers",   "route": "/mcc"},
    "mcc_abuse":       {"color": "#7c3aed", "icon": "Gauge",    "route": "/mcc"},
    "split_ticketing": {"color": "#d97706", "icon": "Split",    "route": "/split"},
    "factoring":       {"color": "#e11d48", "icon": "Share2",   "route": "/factoring"},
    "descriptor":      {"color": "#059669", "icon": "Type",     "route": "/descriptors"},
    "cash":            {"color": "#6366f1", "icon": "Banknote", "route": "/cash"},
}

# ---- teaching layer (plain-English, grounded in the SME review) -------------
EDU = {
    "mcc_miscoding": {
        "tagline": "A benign category code hiding a riskier line of business.",
        "definition": "A merchant registers under a low-risk category code, but actually sells "
                      "something riskier — gambling, adult, pharma — that the bank would have priced "
                      "differently or refused outright.",
        "analogy": "A late-night casino operating behind a shopfront licensed as a ‘gift shop’.",
        "mechanic": [
            "Apply for card acceptance under a boring, low-risk category code (e.g. 5999 misc. retail).",
            "Route the real, higher-risk product through that clean shell.",
            "Behaviour — hours, channel, geography, declines — follows the true business, not the declared one.",
            "Collect the lighter scrutiny, lower fees and smaller reserves the true category would never get.",
        ],
        "cost": "The acquiring bank under-priced the risk and eats the chargebacks; card networks levy "
                "miscoding fines; an illegal true vertical adds regulatory and reputational exposure.",
        "legitTwin": "A genuine specialty retailer resembles none of the prohibited verticals — a miscoder "
                     "lights up several at once. That concurrency is the tell.",
        "victim": "Acquirer + card network + regulator",
    },
    "mcc_abuse": {
        "tagline": "The right business, coded into a cheaper interchange band than it deserves.",
        "definition": "The merchant is roughly in the right business, but is coded into a cheaper "
                      "interchange band than its behaviour warrants — underpaying network fees on every sale.",
        "analogy": "Shipping freight but labelling every pallet ‘documents’ to get the cheaper letter rate.",
        "mechanic": [
            "Get assigned — or negotiate into — a lower interchange band than the behaviour qualifies for.",
            "Flag transactions to hold the cheap rate: mark card-not-present as card-present, one-off as recurring.",
            "Pocket the few basis points of difference across millions of dollars in volume.",
        ],
        "cost": "The network and the acquirer are systematically underpaid; the issuer is under-compensated "
                "for the risk it carries. Audits claw back the shortfall and add assessments.",
        "legitTwin": "A legitimate merchant’s declared band matches its behaviour. Here the paid rate sits "
                     "tens of basis points below the band the behaviour actually warrants.",
        "victim": "Acquirer + card network",
    },
    "split_ticketing": {
        "tagline": "One purchase chopped into bursts to slip under an authorization ceiling.",
        "definition": "A single purchase is deliberately split into several smaller charges within minutes, "
                      "so each fragment stays under an authorization ceiling the whole would have tripped.",
        "analogy": "Buying a $2,000 TV as ten separate $200 gift-cards to dodge the ‘manager approval over $500’ rule.",
        "mechanic": [
            "The real ticket would exceed an auth floor, a review threshold or a no-signature ceiling.",
            "The terminal rings it as several back-to-back charges on the same card.",
            "Each fragment auto-approves under the ceiling; the aggregate never gets a single-transaction review.",
        ],
        "cost": "Bypasses the issuer’s per-transaction risk controls, so fraud and disputes the ceiling was "
                "meant to stop land on the issuer; the acquirer eats chargebacks and limit-avoidance fines.",
        "legitTwin": "Legitimate splits (deposit + balance, partial shipment) are spaced out. Abuse is dense "
                     "in time and hugs the ceiling — that combination is the tell.",
        "victim": "Issuer + acquirer",
    },
    "factoring": {
        "tagline": "One registered account secretly settling for a network of hidden sellers.",
        "definition": "A registered merchant runs other, undisclosed businesses’ card sales through its own "
                      "account — the bank thinks it is paying one shop but is settling for a hidden network.",
        "analogy": "A licensed market stall quietly renting its till to a dozen unlicensed vendors.",
        "mechanic": [
            "A merchant with a clean, approved account lends its ID to third parties who couldn’t get their own.",
            "Those sub-merchants’ sales are injected into the host’s settlement stream.",
            "Descriptors, geographies and volume suddenly diverge from the host’s declared business.",
        ],
        "cost": "The acquirer onboards un-vetted, unknown sellers blind — absorbing their chargebacks and "
                "unknowingly laundering their proceeds, with the AML/BSA liability that carries.",
        "legitTwin": "Legitimate marketplaces and payment facilitators disclose their sub-merchants. Factoring "
                     "hides them — the plurality of undisclosed identities is the tell.",
        "victim": "Acquirer (AML exposure)",
    },
    "descriptor": {
        "tagline": "Rotating the billing name faster than chargeback monitoring can catch up.",
        "definition": "The merchant keeps changing the billing name shown on customer statements, so no single "
                      "name ever accumulates enough chargebacks to enter a monitoring programme.",
        "analogy": "A scam call-centre swapping its caller-ID every few days so no number gets enough complaints to be blocked.",
        "mechanic": [
            "A high-chargeback operation knows networks monitor disputes per billing descriptor.",
            "Before any descriptor crosses a monitoring threshold, it rotates to a fresh, dissimilar name.",
            "Complaints and disputes scatter across many short-lived names, each individually below the radar.",
        ],
        "cost": "Customers can’t recognise the charge to dispute it; issuers field the confusion; the acquirer "
                "harbours a merchant that should already be in a network monitoring programme.",
        "legitTwin": "A one-time rebrand keeps some of the old name and doesn’t reset a chargeback spike. Churn "
                     "shares almost no words between names and repeats — that dissimilarity-over-time is the tell.",
        "victim": "Cardholders + issuer",
    },
    "cash": {
        "tagline": "Card acceptance used as an unlicensed cash-out channel.",
        "definition": "The merchant uses card acceptance to hand out cash — effectively an unlicensed ATM — "
                      "dodging the cash-advance fees and AML scrutiny a real cash business carries.",
        "analogy": "A ‘gift shop’ whose register only ever rings up neat $200 and $500 ‘purchases’ and hands back an envelope of cash.",
        "mechanic": [
            "Charge a card and return most of the value as cash, keeping a fee.",
            "Because it’s coded as retail, it dodges cash-advance interchange, cash-out limits and AML scrutiny.",
            "Enables money laundering and converts stolen cards to untraceable cash.",
        ],
        "cost": "The acquirer becomes an unknowing cash-out and laundering conduit (BSA/OFAC liability); "
                "interchange is under-collected; issuers absorb the stolen-card fraud that gets cashed out.",
        "legitTwin": "Round-number pricing alone is innocent. Cash-out combines round hundreds with high tickets "
                     "and none of retail’s texture — no shipping, no refunds, no variety.",
        "victim": "Acquirer (AML) + issuer",
    },
}

# ---- per-family deviation features: (col, label, plainLabel, kind, expected_col)
DEVIATIONS = {
    "mcc_miscoding": [
        ("pct_cnp", "Card-not-present share", "card-not-present sales", "pct", "mcc_expected_cnp_share"),
        ("pct_night_txn", "Night-hour share", "after-midnight sales", "pct", "mcc_expected_night_share"),
        ("pct_decline_not_permitted", "‘Not permitted’ declines", "blocked-as-not-allowed sales", "pct", None),
        ("pct_round_amount", "Round-amount share", "round-number sales", "pct", None),
        ("pct_offshore_acquirer", "Offshore-acquirer share", "offshore-routed sales", "pct", None),
        ("avg_ticket_usd", "Average ticket", "typical charge", "usd", "mcc_expected_avg_ticket"),
    ],
    "mcc_abuse": [
        ("interchange_advantage_bps", "Interchange advantage", "fee underpayment", "bps", None),
        ("pct_cnp", "Card-not-present share", "card-not-present sales", "pct", "mcc_expected_cnp_share"),
        ("pct_recurring", "Recurring-flagged share", "‘recurring’-tagged sales", "pct", None),
        ("pct_keyed", "Keyed-entry share", "hand-keyed sales", "pct", None),
        ("effective_interchange_bps", "Effective interchange", "rate actually paid", "bps", None),
    ],
    "split_ticketing": [
        ("pct_txn_in_split_burst", "Sales inside a burst", "split-burst sales", "pct", None),
        ("pct_near_ceiling", "Near-ceiling share", "just-under-limit sales", "pct", None),
        ("split_burst_events", "Burst events", "split bursts", "num", None),
        ("mean_split_burst_size", "Avg burst size", "charges per burst", "num", None),
        ("pct_cards_multi_use", "Multi-use cards", "cards used repeatedly", "pct", None),
    ],
    "factoring": [
        ("n_sub_merchant_ids", "Sub-merchant IDs", "hidden sellers", "num", None),
        ("pct_txn_with_sub_merchant", "Sales via sub-merchants", "third-party sales", "pct", None),
        ("volume_spike_ratio", "Volume spike", "sudden volume jump", "num", None),
        ("n_distinct_descriptors", "Distinct billing names", "brands under one account", "num", None),
    ],
    "descriptor": [
        ("descriptor_changes", "Billing-name changes", "name switches", "num", None),
        ("descriptor_name_jaccard", "Name similarity", "word overlap between names", "num", None),
        ("n_distinct_descriptors", "Distinct billing names", "different names used", "num", None),
        ("pct_generic_descriptor", "Generic-name share", "vague-name sales", "pct", None),
        ("chargeback_rate_bps", "Chargeback rate", "customer disputes", "bps", None),
    ],
    "cash": [
        ("pct_round_100", "Round-$100 share", "exact-hundred sales", "pct", None),
        ("avg_ticket_usd", "Average ticket", "typical charge", "usd", "mcc_expected_avg_ticket"),
        ("pct_ticket_gt_500", "Large-ticket share", "charges over $500", "pct", None),
        ("pct_quasi_cash", "Quasi-cash share", "cash-like sales", "pct", None),
    ],
}

# ---- per-family decisive rule threshold panel (rule-routed families) --------
RULE_CHECKS = {
    "mcc_abuse": ("interchange_abuse_rule", [
        ("interchange_advantage_bps", "Interchange advantage", ">", 50, "bps"),
        ("cnp_vs_mcc_expected", "CNP above expected", ">", 0.55, "pct"),
    ], "either path"),
    "split_ticketing": ("split_ticketing_rule", [
        ("pct_txn_in_split_burst", "Sales inside a split burst", ">", 0.10, "pct"),
        ("pct_near_ceiling", "Amounts near the ceiling", ">", 0.15, "pct"),
    ], "all"),
    "factoring": ("factoring_rule", [
        ("n_sub_merchant_ids", "Distinct sub-merchant IDs", "≥", 2, "num"),
        ("volume_spike_ratio", "Volume spike ratio", ">", 3, "num"),
    ], "all"),
    "descriptor": ("descriptor_churn_rule", [
        ("descriptor_changes", "Billing-name changes", "≥", 3, "num"),
        ("descriptor_name_jaccard", "Name word-overlap (Jaccard)", "<", 0.20, "num"),
    ], "all"),
    "cash": ("cash_disbursement_rule", [
        ("pct_round_100", "Round-$100 share", ">", 0.40, "pct"),
        ("avg_ticket_usd", "Average ticket", ">", 400, "usd"),
        ("pct_ticket_gt_500", "Charges over $500", ">", 0.30, "pct"),
    ], "all"),
}

RULE_EXPR = {
    "split_ticketing_rule": "pct_txn_in_split_burst > 0.10  AND  pct_near_ceiling > 0.15",
    "factoring_rule": "n_sub_merchant_ids ≥ 2  AND  volume_spike_ratio > 3",
    "descriptor_churn_rule": "descriptor_changes ≥ 3  AND  descriptor_name_jaccard < 0.20",
    "undeclared_quasi_cash_rule": "pct_quasi_cash > 0.25  AND  MCC not in cash bands",
    "gambling_behaviour_rule": "night > 0.35  AND  round-amount > 0.30  AND  cross-border > 0.30",
    "dispute_excursion_rule": "chargeback_rate_bps > 100  AND  refund_rate > 0.05",
    "issuer_prohibition_rule": "‘transaction not permitted’ decline rate > 0.05",
    "cash_disbursement_rule": "round-$100 > 0.40  AND  avg ticket > $400  AND  >$500 share > 0.30",
    "interchange_abuse_rule": "interchange advantage > 50bps on a cheap band, or CNP-mismatch > 0.55",
}
RULE_LABEL = {
    "split_ticketing_rule": "Split-ticket burst",
    "factoring_rule": "Sub-merchant factoring",
    "descriptor_churn_rule": "Descriptor churn",
    "undeclared_quasi_cash_rule": "Undeclared quasi-cash",
    "gambling_behaviour_rule": "Gambling behaviour signature",
    "dispute_excursion_rule": "Dispute excursion",
    "issuer_prohibition_rule": "Issuer prohibition declines",
    "cash_disbursement_rule": "Cash disbursement",
    "interchange_abuse_rule": "Interchange abuse",
}
RULE_PLAIN = {
    "split_ticketing_rule": "Many charges cluster just under an authorization ceiling, moments apart on one card.",
    "factoring_rule": "Several hidden sub-merchant IDs settle through one account amid a sharp volume spike.",
    "descriptor_churn_rule": "The billing name changes repeatedly to unrelated words — resetting dispute monitoring.",
    "undeclared_quasi_cash_rule": "A large share of sales behave like cash while coded as ordinary goods.",
    "gambling_behaviour_rule": "Night-hour, round-amount, cross-border volume in the signature of an online casino.",
    "dispute_excursion_rule": "Chargebacks and refunds run far above any healthy merchant.",
    "issuer_prohibition_rule": "Issuers keep declining the true product as ‘not permitted’ despite a clean code.",
    "cash_disbursement_rule": "Big, round-number charges with none of retail’s texture — an ATM in disguise.",
    "interchange_abuse_rule": "The rate actually paid sits well below the band the behaviour warrants.",
}

# per-family row-level tells (tag -> reason); the reveal scene explains only these
TELL_WHY = {
    "night": "Booked between 11pm and 5am — a gambling/adult rhythm, not a retailer’s.",
    "round": "An exact round number — people rarely buy goods at precisely $60.00.",
    "cnp": "Card-not-present — no physical card, unusual for the declared shopfront.",
    "offshore": "Settled through an acquirer in a third country the declared business never needs.",
    "declined": "Refused by the issuer — often because the true product isn’t permitted.",
    "recurring": "Tagged ‘recurring’ to qualify for a cheaper interchange band.",
    "cpmismatch": "Flagged card-present, but the channel says card-not-present — a rate-qualification trick.",
    "ceiling": "Sits just below a round authorization ceiling — a split-ticket fragment.",
    "burst": "Part of a same-card burst of charges moments apart.",
    "submerchant": "Carries a sub-merchant ID — a hidden third party settling through this account.",
    "big": "An unusually large, clean ticket — the shape of a cash withdrawal, not a sale.",
}
FAMILY_TELLS = {
    "mcc_miscoding": ["night", "round", "cnp", "offshore", "declined"],
    "mcc_abuse": ["cnp", "recurring", "cpmismatch"],
    "split_ticketing": ["ceiling", "burst", "round"],
    "factoring": ["submerchant", "offshore", "big"],
    "descriptor": ["cnp", "declined", "round"],
    "cash": ["round", "big", "offshore"],
}

TXN_COLS = ["merchant_id", "transaction_datetime_utc", "local_hour", "day_of_week",
            "settlement_amount_usd", "channel", "card_present_flag", "issuer_country",
            "acquirer_country", "merchant_acquirer_country_mismatch", "approved_flag",
            "auth_response_desc", "mcc_description", "merchant_descriptor",
            "recurring_flag", "sub_merchant_id", "split_group_id"]


def num(x, default=0.0):
    try:
        v = float(x)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


def nice_ceiling(x):
    for c in [300, 500, 750, 1000, 1500, 2000, 2500, 3000, 5000, 10000]:
        if c > x:
            return c
    return math.ceil(x / 1000) * 1000


def pick_exemplar(fl, fam):
    g = fl[fl["family"] == fam].copy()
    if g.empty:
        return None
    if fam == "mcc_miscoding":
        base = g[g["txn_count"] >= 150]
        base = base if not base.empty else g
        cand = base
        if "integrity_category" in base.columns:
            aligned = base[(base["top_category"] == base["integrity_category"])
                           & (base["top_category"].isin(P1_CATEGORIES))]
            if aligned.empty:
                aligned = base[base["top_category"] == base["integrity_category"]]
            if not aligned.empty:
                cand = aligned
        return cand.sort_values(["rules_triggered", "txn_count", "exposure_weighted_score"],
                                ascending=False).iloc[0]
    if fam == "mcc_abuse":
        # Interchange abuse only bites at scale: few bps of advantage across large
        # volume. Rank by absolute leaked fees, not the bps figure alone, so the
        # exemplar's dollar harm is teachable — with a floor on volume.
        g = g[g["txn_count"] >= 200] if (g["txn_count"] >= 200).any() else g
        g = g.copy()
        g["_leak"] = g["interchange_advantage_bps"].abs() * g["gross_sales_usd"]
        return g.sort_values(["_leak", "txn_count"], ascending=False).iloc[0]
    keys = {
        "split_ticketing": ["pct_txn_in_split_burst", "split_burst_events", "txn_count"],
        "factoring": ["n_sub_merchant_ids", "volume_spike_ratio", "txn_count"],
        "descriptor": ["descriptor_changes", "txn_count"],
        "cash": ["pct_round_100", "pct_quasi_cash", "txn_count"],
    }[fam]
    keys = [k for k in keys if k in g.columns]
    return g.sort_values(keys, ascending=[False] * len(keys)).iloc[0]


def load_txns(data_dir, mid):
    cols = [c for c in TXN_COLS]
    tx = pd.read_parquet(os.path.join(data_dir, "raw_transactions.parquet"), columns=cols)
    tx = tx[tx["merchant_id"] == mid].copy()
    if tx.empty:
        return tx
    tx["dt"] = pd.to_datetime(tx["transaction_datetime_utc"])
    tx["amt"] = tx["settlement_amount_usd"].abs()
    return tx.sort_values("dt")


def valid_str(v):
    s = str(v)
    return s not in ("", "nan", "None", "NaT")


def row_tells(r, fam, ceiling, declared_country):
    tags = []
    want = FAMILY_TELLS[fam]
    h = int(num(r["local_hour"]))
    amt = num(r["amt"])
    cnp = str(r["card_present_flag"]).upper().startswith("N")
    ecom = "ECOM" in str(r["channel"]).upper() or "MOTO" in str(r["channel"]).upper()
    if "night" in want and (h <= 5 or h >= 23):
        tags.append("night")
    if "round" in want and amt > 0 and amt % 100 == 0:
        tags.append("round")
    if "cnp" in want and cnp:
        tags.append("cnp")
    if "offshore" in want:
        if str(r["merchant_acquirer_country_mismatch"]).upper().startswith("Y") or (
            valid_str(r["acquirer_country"]) and str(r["acquirer_country"]) != str(declared_country)
                and str(r["acquirer_country"]) != str(r["issuer_country"])):
            tags.append("offshore")
    if "declined" in want and not str(r["approved_flag"]).upper().startswith("Y"):
        tags.append("declined")
    if "recurring" in want and str(r["recurring_flag"]).upper().startswith("Y"):
        tags.append("recurring")
    if "cpmismatch" in want and (not cnp) and ecom:
        tags.append("cpmismatch")
    if "ceiling" in want and ceiling and amt >= ceiling * 0.85 and amt < ceiling:
        tags.append("ceiling")
    if "burst" in want and valid_str(r["split_group_id"]):
        tags.append("burst")
    if "submerchant" in want and valid_str(r["sub_merchant_id"]):
        tags.append("submerchant")
    if "big" in want and amt >= 500:
        tags.append("big")
    return tags


def build_sample(tx, fam, ceiling, declared_country, k=12):
    tx = tx.copy()
    tx["tells"] = tx.apply(lambda r: row_tells(r, fam, ceiling, declared_country), axis=1)
    tx["n"] = tx["tells"].apply(len)
    telling = tx[tx["n"] > 0]
    clean = tx[tx["n"] == 0]
    keep = pd.concat([telling.tail(k - 3), clean.tail(3)]).sort_values("dt").tail(k)
    out = []
    for _, r in keep.iterrows():
        out.append({
            "time": r["dt"].strftime("%Y-%m-%d %H:%M"),
            "hour": int(num(r["local_hour"])),
            "amount": round(num(r["amt"]), 2),
            "channel": str(r["channel"]),
            "cardPresent": str(r["card_present_flag"]).upper().startswith("Y"),
            "issuer": str(r["issuer_country"]),
            "acquirer": str(r["acquirer_country"]),
            "approved": str(r["approved_flag"]).upper().startswith("Y"),
            "authDesc": str(r["auth_response_desc"]),
            "descriptor": str(r["merchant_descriptor"]) if valid_str(r["merchant_descriptor"]) else "",
            "tells": r["tells"],
        })
    return out


# ---- per-family signature payloads -----------------------------------------
def sig_fingerprint(ex, cat):
    fp = []
    for c in CATEGORY_WEIGHTS:
        fp.append({"key": c, "label": CATEGORY_LABEL.get(c, c),
                   "tier": CATEGORY_TIER.get(c, "—"),
                   "score": round(num(ex.get(f"score_{c}")), 1), "isTop": c == cat})
    fp.sort(key=lambda d: -d["score"])
    fp = fp[:6]
    lit = sum(1 for f in fp if f["score"] >= 90)
    return {"kind": "fingerprint", "entries": fp, "lit": lit}


def sig_interchange(ex):
    gross = num(ex.get("gross_sales_usd"))
    adv = num(ex.get("interchange_advantage_bps"))
    return {
        "kind": "interchange",
        "declaredBps": round(num(ex.get("mcc_declared_interchange_bps")), 1),
        "expectedBps": round(num(ex.get("behaviour_expected_interchange_bps")), 1),
        "effectiveBps": round(num(ex.get("effective_interchange_bps")), 1),
        "advantageBps": round(adv, 1),
        "cnpVsExpected": round(num(ex.get("cnp_vs_mcc_expected")), 3),
        "grossUsd": round(gross, 2),
        "leakedFeesUsd": round(abs(adv) / 10000.0 * gross, 2),
    }


def sig_split(tx, ex):
    sp = tx[tx["split_group_id"].apply(valid_str)]
    bursts = []
    for gid, g in sp.groupby("split_group_id"):
        amts = sorted(round(num(a), 2) for a in g["amt"])
        bursts.append({"start": g["dt"].min().strftime("%Y-%m-%d %H:%M"),
                       "size": int(len(g)), "total": round(float(sum(amts)), 2), "amounts": amts})
    bursts.sort(key=lambda b: (-b["size"], -b["total"]))
    bursts = bursts[:6]
    all_amts = [a for b in bursts for a in b["amounts"]] or [num(ex.get("avg_ticket_usd"))]
    ceiling = nice_ceiling(np.percentile(all_amts, 95) if all_amts else 500)
    return {
        "kind": "split", "ceiling": ceiling, "bursts": bursts,
        "nearCeilingPct": round(num(ex.get("pct_near_ceiling")), 3),
        "burstEvents": int(num(ex.get("split_burst_events"))),
        "avgGapSec": round(num(ex.get("mean_split_gap_sec")), 0),
    }, ceiling


def sig_factoring(tx, ex):
    sm = tx[tx["sub_merchant_id"].apply(valid_str)]
    subs = []
    for sid, g in sm.groupby("sub_merchant_id"):
        desc = g["merchant_descriptor"].mode()
        subs.append({"id": str(sid),
                     "descriptor": str(desc.iloc[0]) if not desc.empty and valid_str(desc.iloc[0]) else "—",
                     "txns": int(len(g)), "volume": round(float(g["amt"].sum()), 2)})
    subs.sort(key=lambda s: -s["volume"])
    subs = subs[:8]
    monthly = []
    if not tx.empty:
        mv = tx.groupby(tx["dt"].dt.to_period("M"))["amt"].sum()
        for per, v in mv.items():
            monthly.append({"month": str(per), "volume": round(float(v), 2)})
        monthly = monthly[-12:]
    return {
        "kind": "factoring",
        "declared": str(ex.get("merchant_name") or ex.get("dba_name") or ""),
        "nSub": int(num(ex.get("n_sub_merchant_ids"))),
        "subs": subs,
        "spikeRatio": round(num(ex.get("volume_spike_ratio")), 1),
        "pctViaSub": round(num(ex.get("pct_txn_with_sub_merchant")), 3),
        "monthly": monthly,
    }


def sig_descriptor(tx, ex):
    dv = tx[tx["merchant_descriptor"].apply(valid_str)]
    seq = []
    for name, g in dv.groupby("merchant_descriptor"):
        seq.append({"name": str(name), "first": g["dt"].min(), "txns": int(len(g))})
    seq.sort(key=lambda s: s["first"])
    total = sum(s["txns"] for s in seq) or 1
    descriptors = [{"name": s["name"], "firstSeen": s["first"].strftime("%Y-%m-%d"),
                    "txns": s["txns"], "share": round(s["txns"] / total, 3)} for s in seq][:8]
    return {
        "kind": "descriptor",
        "changes": int(num(ex.get("descriptor_changes"))),
        "jaccard": round(num(ex.get("descriptor_name_jaccard")), 3),
        "distinct": int(num(ex.get("n_distinct_descriptors"))),
        "chargebackBps": round(num(ex.get("chargeback_rate_bps")), 0),
        "descriptors": descriptors,
    }


def sig_cash(tx, ex):
    amts = tx["amt"].tolist()
    edges = [0, 100, 200, 300, 400, 500, 750, 1000, 2000, 1e12]
    labels = ["<100", "100", "200", "300", "400", "500", "750", "1k", "2k+"]
    hist = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        cnt = sum(1 for a in amts if lo <= a < hi) if i > 0 else sum(1 for a in amts if a < hi)
        hist.append({"label": labels[i], "count": int(cnt), "round": labels[i] in ("100", "200", "300", "500")})
    # Round-hundred "comb": count exact $100 multiples at each denomination, so the
    # spikes line up with pct_round_100. Contrast with the smooth histogram curve.
    round_hits = []
    for v in range(100, 2001, 100):
        c = sum(1 for a in amts if abs(a - v) < 0.01)
        if c:
            round_hits.append({"amount": v, "count": int(c)})
    return {
        "kind": "cash",
        "roundShare": round(num(ex.get("pct_round_100")), 3),
        "quasiShare": round(num(ex.get("pct_quasi_cash")), 3),
        "gt500Share": round(num(ex.get("pct_ticket_gt_500")), 3),
        "avgTicket": round(num(ex.get("avg_ticket_usd")), 2),
        "histogram": hist,
        "roundHits": round_hits,
    }


def op_pass(actual, op, thr):
    return {">": actual > thr, "≥": actual >= thr, "<": actual < thr, "≤": actual <= thr}[op]


def build_family(s, tx_all, data_dir, fl, fam):
    ex = pick_exemplar(fl, fam)
    if ex is None:
        return None
    mid = ex["merchant_id"]
    tx = load_txns(data_dir, mid)
    declared_country = ex.get("merchant_country")
    cat = ex.get("top_category")

    # signature (also yields ceiling for split tells)
    ceiling = None
    if fam == "mcc_miscoding":
        signature = sig_fingerprint(ex, cat)
    elif fam == "mcc_abuse":
        signature = sig_interchange(ex)
    elif fam == "split_ticketing":
        signature, ceiling = sig_split(tx, ex)
    elif fam == "factoring":
        signature = sig_factoring(tx, ex)
    elif fam == "descriptor":
        signature = sig_descriptor(tx, ex)
    else:
        signature = sig_cash(tx, ex)

    txns = build_sample(tx, fam, ceiling, declared_country)
    declared_as = ""
    if not tx.empty:
        m = tx["mcc_description"].mode()
        declared_as = str(m.iloc[0]) if not m.empty else ""
    declared_as = declared_as or str(ex.get("mcc_group") or "")

    identity = {
        "merchantId": str(mid),
        "name": str(ex.get("merchant_name") or ex.get("dba_name") or mid),
        "corp": str(ex.get("corp_name") or ""),
        "city": str(ex.get("merchant_city") or ""),
        "country": str(ex.get("merchant_country") or ""),
        "declaredMcc": str(ex.get("declared_mcc") or ""),
        "declaredAs": declared_as,
        "mccGroup": str(ex.get("mcc_group") or ""),
        "txnCount": int(num(ex.get("txn_count"))),
        "grossSalesUsd": num(ex.get("gross_sales_usd")),
        "activeDays": int(num(ex.get("active_days"))),
    }

    # deviations (per-family, with plain multiples)
    deviations = []
    for col, label, plain, kind, exp_col in DEVIATIONS[fam]:
        val = num(ex.get(col))
        zval = round(num(ex.get("z_" + col)), 2)
        baseline, blabel = None, None
        if exp_col and exp_col in s.columns and not pd.isna(ex.get(exp_col)):
            baseline, blabel = num(ex.get(exp_col)), "typical for the declared code"
        else:
            peers = s[s["mcc_group"] == ex.get("mcc_group")][col]
            if len(peers) >= 5:
                baseline, blabel = num(peers.median()), "the peer median"
        mult = None
        if baseline is not None and abs(baseline) > 1e-9:
            mult = round(val / baseline, 1)
        deviations.append({
            "key": col, "label": label, "plainLabel": plain, "kind": kind,
            "value": round(val, 3), "z": zval,
            "baseline": round(baseline, 3) if baseline is not None else None,
            "baselineLabel": blabel, "multiple": mult, "hot": abs(zval) >= 1.5,
        })
    deviations.sort(key=lambda d: -abs(d["z"]))

    # composite decomposition (honest for model-routed; shown conditionally in UI)
    norm = np.sqrt(sum(abs(v) for v in OVERALL_WEIGHTS.values()))
    contribs = []
    for feat, w in OVERALL_WEIGHTS.items():
        zval = num(ex.get(feat))
        contribs.append({"key": feat, "label": feat.replace("z_", "").replace("_", " "),
                         "z": round(zval, 2), "weight": w, "contribution": round(zval * w / norm, 3)})
    recon_z = round(sum(c["contribution"] for c in contribs), 3)
    drivers = sorted([c for c in contribs if c["contribution"] > 0],
                     key=lambda c: -c["contribution"])[:6]
    pos_total = sum(c["contribution"] for c in drivers) or 1.0
    for c in drivers:
        c["share"] = round(c["contribution"] / pos_total * 100, 1)

    flag_reason = str(ex.get("flag_reason") or "")
    routed = "model" if "model" in flag_reason and "rule" not in flag_reason else \
             "rule" if "rule" in flag_reason and "model" not in flag_reason else \
             "both" if flag_reason else "model"

    # rule-threshold panel for rule-routed families
    rule_checks = None
    firing_rule = None
    if fam in RULE_CHECKS:
        rname, clauses, mode = RULE_CHECKS[fam]
        firing_rule = RULE_LABEL[rname]
        checks = []
        for col, clabel, op, thr, kind in clauses:
            actual = num(ex.get(col))
            checks.append({"label": clabel, "col": col, "actual": round(actual, 3),
                           "op": op, "threshold": thr, "kind": kind, "pass": bool(op_pass(actual, op, thr))})
        rule_checks = {"rule": rname, "ruleLabel": RULE_LABEL[rname], "mode": mode, "checks": checks}

    score = {
        "integrityRiskScore": round(num(ex.get("integrity_risk_score")), 1),
        "compositeZ": round(num(ex.get("integrity_composite_z")), 3),
        "reconstructedZ": recon_z,
        "percentile": round(num(ex.get("integrity_percentile")), 1),
        "tier": str(ex.get("risk_tier")),
        "exposureWeighted": round(num(ex.get("exposure_weighted_score")), 1),
        "patternScore": round(num(ex.get(f"score_{'cash_disbursement' if fam == 'cash' else fam}")), 1),
        "patternLabel": {
            "mcc_miscoding": "Miscoding pattern score", "mcc_abuse": "Interchange-abuse pattern score",
            "split_ticketing": "Split-ticketing pattern score", "factoring": "Factoring pattern score",
            "descriptor": "Descriptor-churn pattern score", "cash": "Cash-disbursement pattern score",
        }[fam],
        "routedBy": routed,
        "flagReason": flag_reason,
        "drivers": drivers,
        "ruleChecks": rule_checks,
        "tierBins": [
            {"tier": "Low", "range": "≤ 60"}, {"tier": "Monitor", "range": "60–75"},
            {"tier": "Elevated", "range": "75–85"}, {"tier": "High", "range": "85–93"},
            {"tier": "Critical", "range": "> 93"},
        ],
    }

    fired = []
    for name in RULE_EXPR:
        if name in s.columns and int(num(ex.get(name))) == 1:
            fired.append({"name": name, "label": RULE_LABEL[name],
                          "expr": RULE_EXPR[name], "plain": RULE_PLAIN[name]})

    behaves = {
        "mcc_miscoding": (CATEGORY_LABEL.get(cat, cat) or "a prohibited vertical") +
                         (f" ({CATEGORY_TIER.get(cat)})" if CATEGORY_TIER.get(cat, "—") != "—" else ""),
        "mcc_abuse": "an underpriced interchange band",
        "split_ticketing": "one purchase split into sub-ceiling bursts",
        "factoring": "a settlement hub for undisclosed sellers",
        "descriptor": "a rotating-descriptor billing operation",
        "cash": "an unlicensed cash-out channel",
    }[fam]

    verdict = {
        "declaredMcc": str(ex.get("declared_mcc") or ""),
        "declaredAs": declared_as,
        "behavesAs": behaves,
        "familyLabel": FAMILY_LABEL[fam],
        "priorityTier": CATEGORY_TIER.get(cat, "—") if fam == "mcc_miscoding" else "—",
        "riskTier": str(ex.get("risk_tier")),
        "routedBy": routed,
        "firingRule": firing_rule or (fired[0]["label"] if fired else ""),
        "exposure": num(ex.get("gross_sales_usd")),
        "rulesTriggered": int(num(ex.get("rules_triggered"))),
        "trueArchetype": str(ex.get("archetype") or "") if "archetype" in s.columns else "",
    }

    return {
        "key": fam, "label": FAMILY_LABEL[fam],
        "color": FAMILY_META[fam]["color"], "icon": FAMILY_META[fam]["icon"],
        "route": FAMILY_META[fam]["route"],
        "edu": EDU[fam],
        "identity": identity,
        "tells": [{"tag": t, "why": TELL_WHY[t]} for t in FAMILY_TELLS[fam]],
        "transactions": txns,
        "deviations": deviations,
        "signature": signature,
        "score": score,
        "rules": fired,
        "verdict": verdict,
    }


def build(data_dir):
    s = pd.read_csv(os.path.join(data_dir, "merchant_scores.csv"), low_memory=False)
    needed = sorted({c[2:] for w in list(CATEGORY_WEIGHTS.values()) +
                     list(PATTERN_WEIGHTS.values()) + [OVERALL_WEIGHTS] for c in w})
    dev_cols = sorted({col for fam in DEVIATIONS for (col, *_rest) in DEVIATIONS[fam]})
    needed = sorted(set(needed) | set(dev_cols))
    for c in needed:
        if c not in s.columns:
            s[c] = 0.0
    if "mcc_group" not in s.columns:
        s["mcc_group"] = "ALL"
    z = peer_zscores(s, needed)
    s = pd.concat([s, z], axis=1)

    fl = s[s["flag_for_investigation"] == 1].copy()
    fl["family"] = fl.apply(primary_family, axis=1)

    families = []
    for fam in FAMILY_ORDER:
        fdata = build_family(s, None, data_dir, fl, fam)
        if fdata:
            families.append(fdata)

    return {
        "meta": {
            "source": "MCC Miscoding synthetic dataset v2",
            "note": "One real (synthetic) flagged exemplar per integrity family. Peer z-scores, the "
                    "composite decomposition, rule thresholds and signature views are the live "
                    "pipeline’s — no PII or card numbers. Decision-support indicators, not final "
                    "determinations.",
        },
        "families": families,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../MCC Miscoding Data v2/data")
    ap.add_argument("--out", default="../src/data/anatomy.generated.json")
    a = ap.parse_args()

    payload = build(a.data)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(payload, fh, indent=2)
    print(f"wrote {a.out}  ({os.path.getsize(a.out) / 1024:.1f} KB)")
    for f in payload["families"]:
        sc, idn, sig = f["score"], f["identity"], f["signature"]
        print(f"  {f['key']:16s} {idn['name'][:26]:26s} score {sc['integrityRiskScore']:5.1f} "
              f"tier {sc['tier']:8s} routed:{sc['routedBy']:5s} sig:{sig['kind']:11s} "
              f"txns:{len(f['transactions'])} rules:{len(f['rules'])}")


if __name__ == "__main__":
    main()
