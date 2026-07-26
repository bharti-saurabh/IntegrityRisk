#!/usr/bin/env python3
"""
generate_settlement_data.py
---------------------------
Synthetic transaction-level authorisation + clearing/settlement data, shaped the way
a payment network sees it, for the Merchant Integrity Risk demo.

Outputs
    raw_transactions.csv      one row per cleared transaction (the base table)
    dim_merchant.csv          outlet-level merchant dimension
    dim_dba.csv               DBA level
    dim_corp.csv              corp level
    dim_acceptance.csv        merchant x acquiring BIN x CAID relationships
    ground_truth_labels.csv   the answer key: archetype + planted pattern per merchant

Usage
    python generate_settlement_data.py --months 12 --corps 380 --seed 7 --out ./data
    python generate_settlement_data.py --months 24 --corps 1200 --seed 42 --out ./data_big

Scale is driven by --corps. Roughly 900 transactions per corp per year at the
default settings, so 380 corps x 12 months lands near 350k rows.
"""

import argparse
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

from reference_data import (
    COUNTRIES, COUNTRY_BY_CODE, MCC_TABLE, ISSUERS, ACQUIRERS, OFFSHORE_ACQ,
    POS_ENTRY_MODES, POS_CONDITION_CODES, TRANSACTION_TYPES, AUTH_RESPONSE_CODES,
    CVV2_RESULTS, AVS_RESULTS, ECI_VALUES, INTERCHANGE_DESIGNATORS,
    CHARGEBACK_REASONS, FRAUD_TYPES, CARD_PRODUCTS, WALLETS,
    INTERCHANGE_BPS_BY_GROUP, INTERCHANGE_BPS_DEFAULT,
)
from merchant_universe import build_universe, GENERIC_DESCRIPTORS as GD

FX = {"USD": 1.00, "CAD": 0.73, "MXN": 0.058, "BRL": 0.185, "GBP": 1.27, "EUR": 1.08,
      "AED": 0.272, "SGD": 0.745, "HKD": 0.128, "PHP": 0.0175, "INR": 0.0120,
      "AUD": 0.655, "JPY": 0.0066}

DECLINE_MIX_CLEAN = (["05", "51", "14", "54", "61", "91", "N7", "59"],
                     [0.30, 0.34, 0.06, 0.07, 0.08, 0.07, 0.05, 0.03])
DECLINE_MIX_INTEGRITY = (["05", "51", "57", "62", "93", "59", "65", "61", "N7", "14"],
                         [0.20, 0.17, 0.16, 0.10, 0.09, 0.10, 0.06, 0.05, 0.04, 0.03])

SPLIT_CEILINGS = [100.0, 250.0, 500.0, 1000.0, 2500.0]


# --------------------------------------------------------------------------
# Behaviour profile
# --------------------------------------------------------------------------
def behaviour_profile(outlet):
    """Translate archetype + behaviour MCC into the numeric knobs the generator uses."""
    bmcc = outlet["behaviour_mcc"]
    desc, grp, avg_ticket, cnp, night, risk_class = MCC_TABLE[bmcc]
    arch = outlet["archetype"]

    p = dict(
        avg_ticket=avg_ticket,
        ticket_sigma=0.62,
        cnp_share=cnp,
        night_share=night,
        xborder_share=0.05,
        round_amount_share=0.06,
        approval_rate=0.955,
        refund_rate=0.018,
        reversal_rate=0.006,
        cb_rate=0.0009,
        fraud_rate=0.0006,
        recurring_share=0.03,
        token_share=0.22,
        repeat_card_intensity=1.8,
        keyed_share=0.02,
        decline_mix=DECLINE_MIX_CLEAN,
        growth=0.0,
        integrity=False,
    )

    if arch.startswith("clean") or arch == "dormant_tail":
        pass
    elif arch == "mcc_abuse_interchange":
        # Correctly represents its CONTENT (ordinary goods/services) but is coded into a
        # cheaper interchange band than its behaviour warrants. Disputes/fraud stay close
        # to clean — the only anomaly is a channel/ticket profile that does not fit the
        # low-rate card-present category it declared, plus the interchange it pays.
        p.update(cnp_share=min(0.98, cnp + 0.55), approval_rate=0.945,
                 refund_rate=0.024, cb_rate=0.0016, fraud_rate=0.0008,
                 avg_ticket=avg_ticket * 1.15, recurring_share=0.16,
                 token_share=0.28, xborder_share=0.10, round_amount_share=0.08,
                 growth=0.06)
    elif arch == "split_ticketing":
        p.update(approval_rate=0.94, refund_rate=0.030, repeat_card_intensity=3.4,
                 round_amount_share=0.12)
    elif arch == "descriptor_churn_only":
        p.update(cnp_share=min(0.99, cnp + 0.25), approval_rate=0.92,
                 refund_rate=0.045, cb_rate=0.0035, xborder_share=0.18)
    elif arch == "factoring_host":
        p.update(approval_rate=0.93, refund_rate=0.035, cb_rate=0.0040,
                 fraud_rate=0.0022, xborder_share=0.22, growth=0.16)
    else:
        # miscoded / cash disbursement population
        p.update(
            ticket_sigma=0.80,
            xborder_share=0.34,
            round_amount_share=0.31,
            approval_rate=0.876,
            refund_rate=0.052,
            reversal_rate=0.014,
            cb_rate=0.0072,
            fraud_rate=0.0031,
            recurring_share=0.10,
            token_share=0.10,
            repeat_card_intensity=4.2,
            keyed_share=0.06,
            decline_mix=DECLINE_MIX_INTEGRITY,
            growth=0.10,
            integrity=True,
        )
        if arch == "miscoded_gambling":
            p.update(round_amount_share=0.46, night_share=0.44, repeat_card_intensity=6.5,
                     xborder_share=0.42, recurring_share=0.04, cb_rate=0.0085)
        if arch == "miscoded_adult":
            p.update(avg_ticket=avg_ticket * 0.8, recurring_share=0.34, night_share=0.46,
                     cb_rate=0.0130, refund_rate=0.075, descriptor_heavy=True)
        if arch == "miscoded_dating_escort":
            p.update(avg_ticket=avg_ticket * 0.9, recurring_share=0.30, night_share=0.52,
                     cnp_share=0.97, cb_rate=0.0120, refund_rate=0.070,
                     repeat_card_intensity=5.5, descriptor_heavy=True)
        if arch == "miscoded_cyberlocker":
            # subscription file-hosts: low ticket, negative-option recurring, cancel disputes
            p.update(avg_ticket=avg_ticket * 0.85, recurring_share=0.58, cnp_share=0.98,
                     cb_rate=0.0150, refund_rate=0.085, approval_rate=0.86,
                     night_share=0.30)
        if arch == "miscoded_game_of_skill":
            # gambling-adjacent but deliberately softer than miscoded_gambling
            p.update(round_amount_share=0.34, night_share=0.34, repeat_card_intensity=5.0,
                     xborder_share=0.28, cb_rate=0.0060, refund_rate=0.055,
                     approval_rate=0.90)
        if arch == "miscoded_financial_trading":
            # unlicensed FX / CFD: very large round tickets, decline-heavy, offshore.
            # The integrity decline mix already carries insufficient-funds / limit codes.
            p.update(avg_ticket=max(avg_ticket, 620.0), ticket_sigma=0.70,
                     round_amount_share=0.52, xborder_share=0.46, cnp_share=0.96,
                     approval_rate=0.80, cb_rate=0.0095, refund_rate=0.050,
                     repeat_card_intensity=4.0)
        if arch == "miscoded_telemarketing":
            # outbound telemarketing / continuity: high CNP + keyed, service disputes
            p.update(cnp_share=0.90, recurring_share=0.40, keyed_share=0.18,
                     cb_rate=0.0110, refund_rate=0.080, approval_rate=0.865,
                     night_share=0.14)
        if arch == "miscoded_pharma":
            p.update(recurring_share=0.26, xborder_share=0.48, cb_rate=0.0110,
                     refund_rate=0.068)
        if arch == "miscoded_crypto_quasicash":
            p.update(avg_ticket=avg_ticket * 1.1, round_amount_share=0.58,
                     repeat_card_intensity=7.5, approval_rate=0.82, xborder_share=0.40)
        if arch == "miscoded_nutra_subscription":
            p.update(recurring_share=0.62, avg_ticket=avg_ticket * 0.9,
                     cb_rate=0.0180, refund_rate=0.090, approval_rate=0.855)
        if arch == "miscoded_tobacco_vape":
            p.update(cb_rate=0.0045, night_share=0.26, xborder_share=0.20)
        if arch == "cash_disbursement":
            p.update(avg_ticket=780.0, round_amount_share=0.72, ticket_sigma=0.45,
                     repeat_card_intensity=5.5, approval_rate=0.79, cnp_share=0.55)

    # registered / properly coded gambling behaves like gambling but is not a violation
    if outlet.get("is_registered"):
        p.update(approval_rate=0.93, cb_rate=0.0030, refund_rate=0.030,
                 decline_mix=DECLINE_MIX_CLEAN, integrity=False, round_amount_share=0.38,
                 repeat_card_intensity=5.0, night_share=0.42)
    return p


# --------------------------------------------------------------------------
# Helper draws
# --------------------------------------------------------------------------
def build_issuer_pool(rng):
    names = [i[0] for i in ISSUERS]
    ctry = [i[1] for i in ISSUERS]
    bins = [i[2] for i in ISSUERS]
    w = np.array([i[3] for i in ISSUERS], dtype=float)
    w = w / w.sum()
    dom_mask = np.array([c == "US" for c in ctry])
    return dict(names=np.array(names), ctry=np.array(ctry), bins=np.array(bins),
                w=w, dom_idx=np.where(dom_mask)[0], intl_idx=np.where(~dom_mask)[0])


def draw_amounts(rng, n, avg, sigma, round_share):
    mu = np.log(max(avg, 1.0)) - (sigma ** 2) / 2
    amt = rng.lognormal(mu, sigma, n)
    amt = np.clip(amt, 1.0, 25000.0)
    r = rng.random(n) < round_share
    if r.any():
        base = amt[r]
        step = np.where(base < 60, 5.0, np.where(base < 300, 25.0,
                np.where(base < 1200, 50.0, 100.0)))
        amt[r] = np.maximum(step, np.round(base / step) * step)
    return np.round(amt, 2)


def draw_hours(rng, n, night_share):
    """Local hour of day. night_share is the mass sitting in 22:00-05:59."""
    day_hours = np.arange(6, 22)
    day_w = np.array([2, 3, 4, 5, 6, 7, 8, 7, 6, 6, 7, 8, 9, 8, 6, 4], dtype=float)
    day_w /= day_w.sum()
    night_hours = np.array([22, 23, 0, 1, 2, 3, 4, 5])
    night_w = np.array([9, 8, 7, 5, 3, 2, 2, 3], dtype=float)
    night_w /= night_w.sum()
    is_night = rng.random(n) < night_share
    out = np.empty(n, dtype=int)
    nn = int(is_night.sum())
    if nn:
        out[is_night] = rng.choice(night_hours, size=nn, p=night_w)
    if n - nn:
        out[~is_night] = rng.choice(day_hours, size=n - nn, p=day_w)
    return out


# --------------------------------------------------------------------------
# Core generator
# --------------------------------------------------------------------------
def generate(months=12, n_corps=380, seed=7, out_dir="./data",
             volume_scale=1.0, fmt="csv"):
    rng = np.random.default_rng(seed)
    os.makedirs(out_dir, exist_ok=True)

    corps, dbas, outlets, acceptance = build_universe(rng, n_corps=n_corps)
    corp_df = pd.DataFrame(corps)
    dba_df = pd.DataFrame(dbas)
    out_df = pd.DataFrame(outlets)
    acc_df = pd.DataFrame(acceptance)

    acc_by_mid = {}
    for a in acceptance:
        acc_by_mid.setdefault(a["merchant_id"], []).append(a)

    iss = build_issuer_pool(rng)
    cp_codes = [c[0] for c in CARD_PRODUCTS]
    cp_names = {c[0]: c[1] for c in CARD_PRODUCTS}
    cp_fund = {c[0]: c[2] for c in CARD_PRODUCTS}
    cp_class = {c[0]: c[3] for c in CARD_PRODUCTS}
    cp_w = np.array([c[4] for c in CARD_PRODUCTS]); cp_w = cp_w / cp_w.sum()

    end_dt = datetime(2026, 6, 30)
    start_dt = end_dt - timedelta(days=30 * months)
    window_secs = int((end_dt - start_dt).total_seconds())

    chunks = []
    txn_counter = [0]

    def new_ids(n):
        base = txn_counter[0]
        txn_counter[0] += n
        return np.arange(base, base + n)

    for o in outlets:
        prof = behaviour_profile(o)
        rels = acc_by_mid.get(o["merchant_id"], [])
        if not rels:
            continue

        # ---- monthly volume path -----------------------------------------
        active_months = min(months, max(0, months - max(0, o["onboard_months_ago"] - 30)))
        active_months = months if o["onboard_months_ago"] >= months else \
            max(1, months - (months - o["onboard_months_ago"])) if o["onboard_months_ago"] < months else months
        active_months = months if o["onboard_months_ago"] >= months else o["onboard_months_ago"] + 1
        active_months = max(1, min(months, active_months))

        base_vol = float(np.exp(rng.normal(o["monthly_txn_mu"], o["monthly_txn_sigma"])))
        base_vol = float(np.clip(base_vol * volume_scale, 0.05, 1200.0))

        monthly = []
        for m in range(months):
            if m < months - active_months:
                monthly.append(0)
                continue
            k = m - (months - active_months)
            seasonal = 1.0 + 0.16 * np.sin((m / 12.0) * 2 * np.pi) + rng.normal(0, 0.10)
            growth = (1.0 + prof["growth"]) ** k
            v = base_vol * seasonal * growth
            if o["factoring"] and k >= max(1, active_months // 3):
                v *= 4.5 + rng.random() * 3.0          # the volume that is not theirs
            monthly.append(int(np.clip(round(v), 0, 4000)))
        n_total = int(sum(monthly))
        if o["dormant"]:
            # the long tail: a handful of transactions a year, sometimes fewer than
            # the activity threshold. These are what the base-table filter removes.
            n_total = int(rng.choice([1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 10, 13, 17]))
        if n_total == 0:
            continue

        # ---- card population ---------------------------------------------
        n_cards = max(1, int(n_total / max(1.0, prof["repeat_card_intensity"])))
        card_seed = rng.integers(0, 2**31)
        crng = np.random.default_rng(card_seed)
        card_issuer_idx = np.empty(n_cards, dtype=int)
        xb = crng.random(n_cards) < prof["xborder_share"]
        n_xb = int(xb.sum())
        if n_xb:
            card_issuer_idx[xb] = crng.choice(iss["intl_idx"], size=n_xb)
        if n_cards - n_xb:
            card_issuer_idx[~xb] = crng.choice(iss["dom_idx"], size=n_cards - n_xb)
        card_prod = crng.choice(cp_codes, size=n_cards, p=cp_w)
        card_last4 = crng.integers(0, 10000, n_cards)
        card_seq = crng.integers(0, 1000000, n_cards)

        # zipf-ish repeat usage
        pop = crng.random(n_cards) ** (2.6 if prof["repeat_card_intensity"] > 3 else 1.1)
        pop = pop / pop.sum()

        # ---- draw transactions -------------------------------------------
        n = n_total
        card_ix = crng.choice(np.arange(n_cards), size=n, p=pop)
        amt_local = draw_amounts(rng, n, prof["avg_ticket"], prof["ticket_sigma"],
                                 prof["round_amount_share"])

        # timestamps
        sec = np.sort(rng.integers(0, window_secs, n))
        ts = np.array([start_dt + timedelta(seconds=int(s)) for s in sec])
        hours = draw_hours(rng, n, prof["night_share"])
        ts = np.array([t.replace(hour=int(h), minute=int(mi), second=int(se))
                       for t, h, mi, se in zip(ts, hours,
                                               rng.integers(0, 60, n),
                                               rng.integers(0, 60, n))])

        # ---- split ticketing overlay --------------------------------------
        split_group = np.zeros(n, dtype=int)
        if o["split_ticket"]:
            ceiling = SPLIT_CEILINGS[int(rng.integers(0, len(SPLIT_CEILINGS)))]
            n_events = max(1, int(n * 0.16 / 4))
            picks = rng.choice(np.arange(n), size=min(n_events * 4, n), replace=False)
            picks = picks[: (len(picks) // 4) * 4].reshape(-1, 4)
            for gi, grp in enumerate(picks, start=1):
                card = card_ix[grp[0]]
                t0 = ts[grp[0]]
                for j, ix in enumerate(grp):
                    card_ix[ix] = card
                    ts[ix] = t0 + timedelta(minutes=int(3 + j * rng.integers(2, 7)))
                    amt_local[ix] = round(ceiling * (0.88 + rng.random() * 0.10), 2)
                    split_group[ix] = gi

        # ---- cash disbursement overlay ------------------------------------
        quasi = np.zeros(n, dtype=bool)
        if o["quasi_cash"]:
            quasi = rng.random(n) < (0.62 if o["cash_disbursement"] else 0.35)

        # ---- factoring overlay: alien sub-merchant blocks ------------------
        sub_desc = np.array([o["base_descriptor"]] * n, dtype=object)
        sub_id = np.array([""] * n, dtype=object)
        if o["factoring"]:
            alien_mccs = ["7995", "5967", "6051", "7841", "5122"]
            n_alien = int(rng.integers(2, 5))
            aliens = rng.choice(alien_mccs, size=n_alien, replace=False)
            alien_share = 0.72
            mask = rng.random(n) < alien_share
            idx = np.where(mask)[0]
            assign = rng.choice(np.arange(n_alien), size=len(idx))
            for k, am in enumerate(aliens):
                sel = idx[assign == k]
                if len(sel) == 0:
                    continue
                a_avg = MCC_TABLE[am][2]
                amt_local[sel] = draw_amounts(rng, len(sel), a_avg, 0.85, 0.42)
                sub_desc[sel] = f"{GD[k % len(GD)]} {int(rng.integers(100,999))}"
                sub_id[sel] = f"SUB{int(rng.integers(10**6, 10**7)):07d}"

        # ---- descriptor churn ----------------------------------------------
        if o["descriptor_churn"]:
            n_variants = int(rng.integers(3, 8))
            variants = []
            stem = "".join(ch for ch in o["merchant_name"].upper() if ch.isalnum())[:10]
            for v in range(n_variants):
                style = rng.random()
                if style < 0.35:
                    variants.append(f"{stem}{int(rng.integers(10,99))}")
                elif style < 0.6:
                    variants.append(GD[int(rng.integers(0, len(GD)))])
                elif style < 0.8:
                    variants.append(f"WWW.{stem[:8]}{int(rng.integers(1,99))}.COM")
                else:
                    variants.append(f"HELP*{stem[:8]}{int(rng.integers(100,999))}")
            order = np.argsort(sec)
            cut = np.array_split(order, n_variants)
            for v, seg in enumerate(cut):
                sub_desc[seg] = variants[v]

        # ---- channel / entry mode ------------------------------------------
        is_cnp = rng.random(n) < prof["cnp_share"]
        is_recur = is_cnp & (rng.random(n) < prof["recurring_share"] / max(prof["cnp_share"], .01))
        is_moto = is_cnp & ~is_recur & (rng.random(n) < 0.06)
        is_token = is_cnp & (rng.random(n) < prof["token_share"])
        keyed = ~is_cnp & (rng.random(n) < prof["keyed_share"])

        pos_entry = np.where(is_recur, "10",
                     np.where(is_moto, "01",
                      np.where(is_cnp, "81",
                       np.where(keyed, "01",
                        np.where(rng.random(n) < 0.42, "07",
                         np.where(rng.random(n) < 0.85, "05", "90"))))))
        pos_cond = np.where(is_recur, "02",
                    np.where(is_moto, "08",
                     np.where(is_cnp, "59",
                      np.where(rng.random(n) < 0.30, "71", "00"))))
        channel = np.where(is_recur, "RECURRING",
                   np.where(is_moto, "MOTO",
                    np.where(is_cnp, "ECOMMERCE", "POS")))
        card_present = np.where(is_cnp, "N", "Y")
        cardholder_present = np.where(is_cnp | is_moto, "N", "Y")

        # ---- issuer / card fields -------------------------------------------
        ii = card_issuer_idx[card_ix]
        issuer_name = iss["names"][ii]
        issuer_ctry = iss["ctry"][ii]
        issuer_bin = iss["bins"][ii]
        prod = card_prod[card_ix]
        l4 = card_last4[card_ix]
        cseq = card_seq[card_ix]
        pan_masked = np.array([f"{b}******{x:04d}" for b, x in zip(issuer_bin, l4)], dtype=object)
        card_token = np.array([f"TKN{b[:6]}{s:06d}" for b, s in zip(issuer_bin, cseq)], dtype=object)

        # ---- acquiring relationship -------------------------------------------
        rsel = rng.integers(0, len(rels), n)
        acq_bin = np.array([rels[i]["acquirer_bin"] for i in rsel], dtype=object)
        acq_name = np.array([rels[i]["acquirer_name"] for i in rsel], dtype=object)
        acq_ctry = np.array([rels[i]["acquirer_country"] for i in rsel], dtype=object)
        caid = np.array([rels[i]["card_acceptor_id"] for i in rsel], dtype=object)
        term = np.array([rels[i]["terminal_id"] for i in rsel], dtype=object)

        # ---- currency / amounts -------------------------------------------
        m_ctry = o["merchant_country"]
        m_cur = COUNTRY_BY_CODE[m_ctry][4]
        m_cur_num = COUNTRY_BY_CODE[m_ctry][5]
        if m_cur != "USD":
            amt_local = np.round(amt_local / FX[m_cur], 2)
        settle_amt = np.round(amt_local * FX[m_cur], 2)                 # USD settlement
        bill_cur = np.array([COUNTRY_BY_CODE[c][4] for c in issuer_ctry], dtype=object)
        bill_fx = np.array([FX[c] for c in bill_cur])
        bill_amt = np.round(settle_amt / bill_fx * (1 + rng.normal(0, 0.004, n)), 2)

        # ---- auth outcome ---------------------------------------------------
        approved = rng.random(n) < prof["approval_rate"]
        dcodes, dw = prof["decline_mix"]
        resp = np.where(approved, "00", rng.choice(dcodes, size=n, p=dw))
        # a slice of approvals are partial approvals
        part = approved & (rng.random(n) < 0.004)
        resp = np.where(part, "10", resp)
        approved_flag = np.isin(resp, ["00", "10"])

        # ---- transaction type ------------------------------------------------
        ttype = np.where(quasi, np.where(rng.random(n) < 0.4, "01", "11"), "00")
        cashback = np.where((~is_cnp) & (rng.random(n) < 0.03),
                            np.round(rng.choice([20, 40, 60, 100], n), 2), 0.0)
        ttype = np.where(cashback > 0, "09", ttype)

        # ---- risk / verification --------------------------------------------
        cvv2 = np.where(is_cnp,
                        rng.choice(["M", "N", "P", "U"], n, p=[0.86, 0.05, 0.06, 0.03]),
                        rng.choice(["", "S"], n, p=[0.93, 0.07]))
        avs = np.where(is_cnp,
                       rng.choice(["Y", "Z", "A", "N", "U"], n, p=[0.64, 0.14, 0.08, 0.08, 0.06]),
                       np.array([""] * n, dtype=object))
        eci = np.where(is_cnp,
                       rng.choice(["05", "06", "07"], n, p=[0.55, 0.20, 0.25]),
                       np.array([""] * n, dtype=object))
        if prof["integrity"]:
            eci = np.where(is_cnp, rng.choice(["05", "06", "07"], n, p=[0.22, 0.18, 0.60]), eci)
        wallet = np.where(is_token, rng.choice(["APPLE_PAY", "GOOGLE_PAY", "SAMSUNG_PAY",
                                                "CLICK_TO_PAY"], n, p=[.45, .32, .12, .11]),
                          np.array([""] * n, dtype=object))

        # ---- cross border flags ------------------------------------------------
        xborder = issuer_ctry != np.array([acq_ctry], dtype=object).reshape(-1)
        xborder_flag = np.where(xborder, "CROSS_BORDER", "DOMESTIC")
        m_vs_acq = np.array([m_ctry] * n, dtype=object) != acq_ctry

        # ---- clearing / settlement --------------------------------------------
        lag_days = rng.choice([1, 1, 2, 2, 3, 4], n)
        settle_date = np.array([(t + timedelta(days=int(d))).date() for t, d in zip(ts, lag_days)])
        clearing_date = np.array([(t + timedelta(days=int(max(1, d - 1)))).date()
                                  for t, d in zip(ts, lag_days)])
        # ---- interchange: anchored on the DECLARED MCC's regulated band -----------
        # The interchange a merchant pays is set by the category it is coded into, not by
        # how it actually behaves. An mcc_abuse merchant declaring grocery/fuel/charity
        # therefore pays that cheap band (~115-140 bps) while running a high-CNP profile
        # that would ordinarily settle ~235 bps. A CNP uplift and per-txn noise sit on top.
        declared_grp = MCC_TABLE[o["declared_mcc"]][1]
        base_bps = INTERCHANGE_BPS_BY_GROUP.get(declared_grp, INTERCHANGE_BPS_DEFAULT)
        cnp_uplift_bps = np.where(is_cnp, 25.0, 0.0)
        keyed_uplift_bps = np.where(keyed, 12.0, 0.0)
        noise_bps = rng.normal(0.0, 8.0, n)
        ic_rate = np.clip(base_bps + cnp_uplift_bps + keyed_uplift_bps + noise_bps,
                          70.0, 320.0) / 10000.0
        ic_fee = np.round(settle_amt * ic_rate + np.where(is_cnp, 0.10, 0.05), 4)
        net_fee = np.round(settle_amt * 0.0013 + 0.0195, 4)
        ic_desig = rng.choice(INTERCHANGE_DESIGNATORS, n)

        # ---- downstream events -------------------------------------------------
        refund = approved_flag & (rng.random(n) < prof["refund_rate"])
        reversal = approved_flag & (rng.random(n) < prof["reversal_rate"])
        cb = approved_flag & (rng.random(n) < prof["cb_rate"])
        fraud = approved_flag & (rng.random(n) < prof["fraud_rate"])
        cb = cb | fraud
        cb_reason = np.where(cb,
                             np.where(fraud,
                                      rng.choice(["10.4", "10.3", "10.1", "10.2", "10.5"], n,
                                                 p=[.55, .17, .13, .10, .05]),
                                      rng.choice(["13.1", "13.2", "13.3", "13.5", "13.6",
                                                  "12.5", "12.6", "11.3"], n,
                                                 p=[.22, .20, .14, .14, .12, .07, .06, .05])),
                             np.array([""] * n, dtype=object))
        fraud_type = np.where(fraud, rng.choice(FRAUD_TYPES, n), np.array([""] * n, dtype=object))
        cb_amt = np.where(cb, settle_amt, 0.0)
        fraud_amt = np.where(fraud, settle_amt, 0.0)

        # transaction_type override for refunds (credits)
        ttype = np.where(refund, "20", ttype)
        signed_settle = np.where(refund, -settle_amt, settle_amt)

        ids = new_ids(n)
        loc_off = COUNTRY_BY_CODE[m_ctry][6]

        chunk = dict(
            transaction_id=np.array([f"TXN{i:012d}" for i in ids], dtype=object),
            arn=np.char.add(
                np.char.add(np.char.zfill(rng.integers(0, 10**12, n).astype(str), 12),
                            np.char.zfill(rng.integers(0, 10**11, n).astype(str), 11)),
                "").astype(object),
            rrn=np.char.zfill(rng.integers(0, 10**12, n).astype(str), 12).astype(object),
            stan=np.char.zfill(rng.integers(1, 999999, n).astype(str), 6).astype(object),
            auth_code=np.where(approved_flag,
                               np.char.zfill(rng.integers(0, 999999, n).astype(str), 6),
                               "").astype(object),
            batch_id=np.char.add("B", np.char.zfill(rng.integers(10**7, 10**8, n).astype(str), 8)).astype(object),

            transaction_datetime_utc=np.array([t.strftime("%Y-%m-%d %H:%M:%S") for t in ts], dtype=object),
            transaction_date=np.array([t.date().isoformat() for t in ts], dtype=object),
            local_transaction_time=np.array(
                [(t + timedelta(hours=loc_off)).strftime("%H:%M:%S") for t in ts], dtype=object),
            local_hour=np.array([(t + timedelta(hours=loc_off)).hour for t in ts]),
            day_of_week=np.array([t.strftime("%a") for t in ts], dtype=object),
            clearing_date=np.array([d.isoformat() for d in clearing_date], dtype=object),
            settlement_date=np.array([d.isoformat() for d in settle_date], dtype=object),
            days_auth_to_settlement=lag_days,

            pan_masked=pan_masked,
            card_token_id=card_token,
            issuer_bin=issuer_bin,
            issuer_name=issuer_name,
            issuer_country=issuer_ctry,
            issuer_region=np.array([COUNTRY_BY_CODE[c][3] for c in issuer_ctry], dtype=object),
            card_product_id=prod,
            card_product_name=np.array([cp_names[p] for p in prod], dtype=object),
            funding_source=np.array([cp_fund[p] for p in prod], dtype=object),
            account_class=np.array([cp_class[p] for p in prod], dtype=object),

            acquirer_bin=acq_bin,
            acquirer_name=acq_name,
            acquirer_country=acq_ctry,
            card_acceptor_id=caid,
            terminal_id=term,

            merchant_id=np.array([o["merchant_id"]] * n, dtype=object),
            merchant_name=np.array([o["merchant_name"]] * n, dtype=object),
            dba_id=np.array([o["dba_id"]] * n, dtype=object),
            corp_id=np.array([o["corp_id"]] * n, dtype=object),
            merchant_descriptor=sub_desc,
            sub_merchant_id=sub_id,
            merchant_city=np.array([o["merchant_city"]] * n, dtype=object),
            merchant_state=np.array([o["merchant_state"]] * n, dtype=object),
            merchant_postal=np.array([o["merchant_postal"]] * n, dtype=object),
            merchant_country=np.array([m_ctry] * n, dtype=object),
            mcc=np.array([o["declared_mcc"]] * n, dtype=object),
            mcc_description=np.array([MCC_TABLE[o["declared_mcc"]][0]] * n, dtype=object),

            transaction_amount=amt_local,
            transaction_currency=np.array([m_cur] * n, dtype=object),
            transaction_currency_code=np.array([m_cur_num] * n, dtype=object),
            settlement_amount_usd=np.round(signed_settle, 2),
            settlement_currency=np.array(["USD"] * n, dtype=object),
            billing_amount=bill_amt,
            billing_currency=bill_cur,
            fx_rate=np.round(FX[m_cur] / bill_fx, 6),
            cashback_amount=cashback,

            transaction_type_code=ttype,
            transaction_type_desc=np.array([TRANSACTION_TYPES[t] for t in ttype], dtype=object),
            processing_code=np.array([f"{t}0000" for t in ttype], dtype=object),
            pos_entry_mode=pos_entry,
            pos_entry_mode_desc=np.array([POS_ENTRY_MODES[p] for p in pos_entry], dtype=object),
            pos_condition_code=pos_cond,
            pos_condition_desc=np.array([POS_CONDITION_CODES[p] for p in pos_cond], dtype=object),
            channel=channel,
            card_present_flag=card_present,
            cardholder_present_flag=cardholder_present,
            recurring_flag=np.where(is_recur, "Y", "N"),
            installment_flag=np.where(is_recur & (rng.random(n) < 0.15), "Y", "N"),
            moto_flag=np.where(is_moto, "Y", "N"),
            token_flag=np.where(is_token, "Y", "N"),
            wallet_provider=wallet,

            auth_response_code=resp,
            auth_response_desc=np.array([AUTH_RESPONSE_CODES[r][0] for r in resp], dtype=object),
            approved_flag=np.where(approved_flag, "Y", "N"),
            cvv2_result=cvv2,
            avs_result=avs,
            eci_indicator=eci,
            three_ds_flag=np.where(np.isin(eci, ["05", "06"]), "Y", "N"),

            domestic_xborder_flag=xborder_flag,
            merchant_acquirer_country_mismatch=np.where(m_vs_acq, "Y", "N"),

            interchange_fee_usd=ic_fee,
            interchange_rate_designator=ic_desig,
            network_fee_usd=net_fee,
            settlement_service_id=np.char.add("SS", rng.integers(100, 999, n).astype(str)).astype(object),

            refund_flag=np.where(refund, "Y", "N"),
            reversal_flag=np.where(reversal, "Y", "N"),
            chargeback_flag=np.where(cb, "Y", "N"),
            chargeback_reason_code=cb_reason,
            chargeback_reason_desc=np.array(
                [CHARGEBACK_REASONS.get(c, "") for c in cb_reason], dtype=object),
            chargeback_amount_usd=np.round(cb_amt, 2),
            fraud_flag=np.where(fraud, "Y", "N"),
            fraud_type=fraud_type,
            fraud_amount_usd=np.round(fraud_amt, 2),

            split_group_id=np.where(split_group > 0,
                                    np.array([f"{o['merchant_id']}-SG{g:04d}" for g in split_group],
                                             dtype=object),
                                    np.array([""] * n, dtype=object)),
        )
        chunks.append(chunk)

    cols = list(chunks[0].keys())
    data = {c: np.concatenate([ch[c] for ch in chunks]) for c in cols}
    tx = pd.DataFrame(data)
    tx = tx.sort_values("transaction_datetime_utc").reset_index(drop=True)

    # ---------------- ground truth -----------------------------------------
    gt = out_df[["merchant_id", "dba_id", "corp_id", "archetype", "declared_mcc",
                 "behaviour_mcc", "integrity_category", "integrity_tier", "is_registered",
                 "split_ticket", "factoring", "descriptor_churn", "quasi_cash",
                 "cash_disbursement", "interchange_abuse", "dormant"]].copy()
    gt["interchange_abuse"] = gt["interchange_abuse"].fillna(False).astype(bool)

    # Interchange abuse is a distinct exposure class: the content is coded honestly enough
    # that it is NOT a prohibited-content miscoding, but it is placed in a cheaper interchange
    # band than its behaviour warrants. It is tracked separately from integrity violations so
    # the two populations (illegal/prohibited content vs. issuer-revenue leakage) stay clean.
    gt["is_interchange_abuse"] = gt["interchange_abuse"] & ~gt["is_registered"]
    gt["is_integrity_violation"] = (
        (gt["declared_mcc"] != gt["behaviour_mcc"])
        | gt["split_ticket"] | gt["factoring"] | gt["cash_disbursement"]
    ) & ~gt["is_registered"] & ~gt["interchange_abuse"]

    # ---------------- write -------------------------------------------------
    base = os.path.join(out_dir, "raw_transactions")
    if fmt in ("csv", "both"):
        tx.to_csv(base + ".csv", index=False)
    if fmt in ("gz", "both"):
        tx.to_csv(base + ".csv.gz", index=False, compression="gzip")
    if fmt in ("parquet", "both"):
        try:
            tx.to_parquet(base + ".parquet", index=False)
        except Exception as e:
            print("parquet skipped:", e)
    out_df.drop(columns=["monthly_txn_mu", "monthly_txn_sigma"]).to_csv(
        os.path.join(out_dir, "dim_merchant.csv"), index=False)
    dba_df.to_csv(os.path.join(out_dir, "dim_dba.csv"), index=False)
    corp_df.to_csv(os.path.join(out_dir, "dim_corp.csv"), index=False)
    acc_df.to_csv(os.path.join(out_dir, "dim_acceptance.csv"), index=False)
    gt.to_csv(os.path.join(out_dir, "ground_truth_labels.csv"), index=False)

    print(f"rows            {len(tx):,}")
    print(f"merchants       {tx.merchant_id.nunique():,}")
    print(f"dbas            {dba_df.dba_id.nunique():,}")
    print(f"corps           {corp_df.corp_id.nunique():,}")
    print(f"acceptance rows {len(acc_df):,}")
    print(f"date range      {tx.transaction_date.min()} to {tx.transaction_date.max()}")
    print(f"planted violations {int(gt.is_integrity_violation.sum()):,} merchants")
    print(f"interchange abuse  {int(gt.is_interchange_abuse.sum()):,} merchants")
    print(f"written to      {os.path.abspath(out_dir)}")
    return tx


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=12)
    ap.add_argument("--corps", type=int, default=380)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=str, default="./data")
    ap.add_argument("--volume-scale", type=float, default=1.0,
                    help="multiplier on per-merchant monthly volume")
    ap.add_argument("--format", type=str, default="csv",
                    choices=["csv", "gz", "parquet", "both"])
    a = ap.parse_args()
    generate(months=a.months, n_corps=a.corps, seed=a.seed, out_dir=a.out,
             volume_scale=a.volume_scale, fmt=a.format)
