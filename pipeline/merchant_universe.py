"""
merchant_universe.py
Builds the merchant hierarchy that the transaction generator draws from.

Hierarchy
    CORP        legal / ultimate parent entity      e.g. "Apple Inc"
      DBA       trading brand                       e.g. "Apple Store", "iTunes Store"
        OUTLET  merchant (the acceptance location)  e.g. "Apple Store Cupertino"

Each OUTLET carries one or more (acquirer_bin, caid) acceptance relationships.
Each OUTLET is assigned a behavioural archetype. Clean archetypes behave like the
MCC they declare. Integrity archetypes declare one MCC and behave like another,
which is the whole point of the exercise.
"""

import numpy as np
from reference_data import (
    MCC_TABLE, ACQUIRERS, US_CITIES, COUNTRY_BY_CODE, OFFSHORE_ACQ,
)

# --------------------------------------------------------------------------
# Name parts
# --------------------------------------------------------------------------
CORP_A = ["Northwind", "Cedarline", "Bright Harbor", "Ironwood", "Halcyon", "Verdant",
          "Blue Meridian", "Copper Creek", "Silverleaf", "Granite Point", "Willowbrook",
          "Redstone", "Arcadia", "Summit Ridge", "Lantern", "Fairmount", "Harborview",
          "Stonebridge", "Clearwater", "Pinnacle", "Evergreen", "Coastline", "Foxglove",
          "Thornfield", "Meadowlark", "Kingfisher", "Alder & Vine", "Baywater",
          "Crown Point", "Dovetail", "Elmgrove", "Firelight", "Goldenrod", "Hawthorne",
          "Juniper Bay", "Larkspur", "Marbleton", "Nightjar", "Orchard Hill", "Quarry Lane"]
CORP_B = ["Holdings", "Group", "Enterprises", "Ventures", "Commerce", "Industries",
          "Partners", "Brands", "Retail Corp", "Trading Co", "Capital", "LLC",
          "International", "Worldwide", "Networks", "Concepts"]

DBA_RETAIL = ["Market", "Provisions", "Outfitters", "Supply Co", "Depot", "Emporium",
              "Trading Post", "Mercantile", "Bazaar", "Corner Store", "General Store"]
DBA_FOOD   = ["Kitchen", "Grill", "Bistro", "Taqueria", "Noodle Bar", "Coffee House",
              "Bakehouse", "Smokehouse", "Cantina", "Pizzeria", "Deli"]
DBA_DIGITAL= ["Digital", "Online", "Media", "Studio", "Labs", "Cloud", "Interactive",
              "Play", "Stream", "Direct"]
DBA_SERVICE= ["Services", "Solutions", "Consulting", "Care", "Wellness", "Clinic",
              "Advisors", "Works"]

SHELL_WORDS = ["Global", "Prime", "Elite", "Premier", "Apex", "Nova", "Vertex", "Onyx",
               "Zenith", "Quantum", "Stellar", "Titan", "Orbit", "Fusion", "Helix"]
SHELL_TAIL  = ["Ltd", "Holdings Ltd", "SARL", "BV", "Pte Ltd", "NV", "GmbH", "LLC",
               "Trading", "Commerce Ltd"]

GENERIC_DESCRIPTORS = ["ONLINE PURCHASE", "WEB PAYMENT", "MERCHANT SERVICES",
                       "SVC PAYMENT", "DIGITAL SVCS", "ECOM PMT", "PURCHASE",
                       "CUSTOMER SERVICE", "BILLING DEPT", "SUBSCRIPTION SVC"]

# --------------------------------------------------------------------------
# Archetypes
# --------------------------------------------------------------------------
# Each archetype describes *behaviour*. declared_mcc is what the merchant tells
# the acquirer. behaviour_mcc is what the transaction stream actually looks like.
ARCHETYPES = {
    # ---------------- clean population -----------------------------------
    "clean_restaurant": dict(
        weight=0.125, declared=["5812", "5814"], behaves_as=None,
        integrity_category=None, monthly_txn=(3.4, 0.80),
        acq_profile=["bank", "psp", "payfac"], n_outlets=(1, 8),
    ),
    "clean_grocery_fuel": dict(
        weight=0.095, declared=["5411", "5541"], behaves_as=None,
        integrity_category=None, monthly_txn=(4.0, 0.70),
        acq_profile=["bank"], n_outlets=(1, 10),
    ),
    "clean_apparel": dict(
        weight=0.07, declared=["5651", "5691", "5944"], behaves_as=None,
        integrity_category=None, monthly_txn=(3.2, 0.85),
        acq_profile=["bank", "psp"], n_outlets=(1, 6),
    ),
    "clean_ecom": dict(
        weight=0.115, declared=["5999", "5399", "5732", "5045"], behaves_as=None,
        integrity_category=None, monthly_txn=(3.7, 0.95),
        acq_profile=["psp", "payfac", "bank"], n_outlets=(1, 3),
    ),
    "clean_digital": dict(
        weight=0.06, declared=["5815", "5816", "5817", "4816", "4899"], behaves_as=None,
        integrity_category=None, monthly_txn=(4.1, 0.95),
        acq_profile=["psp", "payfac"], n_outlets=(1, 2),
    ),
    "clean_travel": dict(
        weight=0.05, declared=["7011", "4511", "4722", "4121"], behaves_as=None,
        integrity_category=None, monthly_txn=(3.1, 0.90),
        acq_profile=["bank", "psp"], n_outlets=(1, 5),
    ),
    "clean_services": dict(
        weight=0.07, declared=["7230", "7299", "7392", "8011", "8062", "8999"], behaves_as=None,
        integrity_category=None, monthly_txn=(2.8, 0.85),
        acq_profile=["bank", "payfac"], n_outlets=(1, 4),
    ),
    "clean_licensed_pharmacy": dict(
        weight=0.03, declared=["5912"], behaves_as=None,
        integrity_category=None, monthly_txn=(3.6, 0.70),
        acq_profile=["bank"], n_outlets=(1, 5),
    ),
    "clean_registered_gaming": dict(  # properly coded, registered gambling merchant
        weight=0.015, declared=["7995"], behaves_as=None,
        integrity_category="gambling", registered=True, monthly_txn=(4.4, 0.80),
        acq_profile=["bank", "psp"], n_outlets=(1, 2),
    ),
    "dormant_tail": dict(             # the long tail the activity filter removes
        weight=0.16, declared=["5812", "5999", "7230", "5399", "7299", "5651"],
        behaves_as=None, integrity_category=None, monthly_txn=(-0.70, 1.20),
        acq_profile=["bank", "psp", "payfac"], n_outlets=(1, 1), dormant=True,
    ),

    # ---------------- integrity risk population ---------------------------
    # MCC-miscoding family, tier P1 (highest-harm prohibited content)
    "miscoded_gambling": dict(
        weight=0.028, declared=["5812", "5999", "7299", "5734", "8999"],
        behaves_as="7995", integrity_category="gambling", integrity_tier="P1",
        monthly_txn=(4.5, 0.85),
        acq_profile=["offshore", "payfac", "psp"], n_outlets=(1, 3),
        descriptor_churn=True,
    ),
    "miscoded_adult": dict(
        weight=0.018, declared=["5815", "5817", "5999", "7299", "4816"],
        behaves_as="7841", integrity_category="adult", integrity_tier="P1",
        monthly_txn=(4.3, 0.85),
        acq_profile=["offshore", "payfac"], n_outlets=(1, 2),
        descriptor_churn=True,
    ),
    "miscoded_dating_escort": dict(   # split out of "adult": dating / escort services
        weight=0.014, declared=["5815", "7299", "5999", "4816", "7273"],
        behaves_as="7273", integrity_category="dating_escort", integrity_tier="P1",
        monthly_txn=(4.2, 0.85),
        acq_profile=["offshore", "payfac", "psp"], n_outlets=(1, 2),
        descriptor_churn=True,
    ),
    "miscoded_pharma": dict(
        weight=0.020, declared=["5399", "5999", "5968", "8999"],
        behaves_as="5122", integrity_category="pharma", integrity_tier="P1",
        monthly_txn=(4.0, 0.85),
        acq_profile=["offshore", "psp", "payfac"], n_outlets=(1, 2),
        descriptor_churn=True,
    ),
    # MCC-miscoding family, tier P2 (emerging / grey)
    "miscoded_crypto_quasicash": dict(
        weight=0.016, declared=["5734", "5045", "7392", "5999"],
        behaves_as="6051", integrity_category="crypto_cash", integrity_tier="P2",
        monthly_txn=(3.4, 0.90),
        acq_profile=["offshore", "psp"], n_outlets=(1, 2),
        quasi_cash=True,
    ),
    "miscoded_cyberlocker": dict(     # file-host / "premium download" subscriptions
        weight=0.011, declared=["4816", "5734", "5817", "5999"],
        behaves_as="5815", integrity_category="cyberlocker", integrity_tier="P2",
        monthly_txn=(4.3, 0.90),
        acq_profile=["offshore", "payfac", "psp"], n_outlets=(1, 2),
        descriptor_churn=True, negative_option=True,
    ),
    "miscoded_game_of_skill": dict(   # skill-gaming / prize contests behaving like betting
        weight=0.011, declared=["7994", "5816", "7999", "5999"],
        behaves_as="7995", integrity_category="game_of_skill", integrity_tier="P2",
        monthly_txn=(4.1, 0.85),
        acq_profile=["payfac", "psp", "offshore"], n_outlets=(1, 2),
    ),
    # MCC-miscoding family, tier P3 (weaker signal / lower harm)
    "miscoded_tobacco_vape": dict(
        weight=0.010, declared=["5999", "5399", "5921"],
        behaves_as="5993", integrity_category="tobacco_vape", integrity_tier="P3",
        monthly_txn=(3.6, 0.75),
        acq_profile=["psp", "payfac"], n_outlets=(1, 3),
    ),
    "miscoded_financial_trading": dict(  # unlicensed FX / CFD / "trading academy"
        weight=0.011, declared=["7392", "8999", "6012", "5999"],
        behaves_as="6211", integrity_category="financial_trading", integrity_tier="P3",
        monthly_txn=(3.6, 0.85),
        acq_profile=["offshore", "psp"], n_outlets=(1, 2),
    ),
    "miscoded_telemarketing": dict(   # outbound telemarketing / continuity behaving as retail
        weight=0.012, declared=["5999", "7299", "8999", "5969"],
        behaves_as="5966", integrity_category="telemarketing", integrity_tier="P3",
        monthly_txn=(4.0, 0.85),
        acq_profile=["payfac", "psp"], n_outlets=(1, 2),
        descriptor_churn=True,
    ),
    "miscoded_nutra_subscription": dict(
        weight=0.020, declared=["5399", "5999", "5912", "8999"],
        behaves_as="5968", integrity_category="nutra_subscription", integrity_tier="P3",
        monthly_txn=(4.4, 0.80),
        acq_profile=["payfac", "psp", "offshore"], n_outlets=(1, 2),
        descriptor_churn=True, negative_option=True,
    ),
    # ---- non-miscoding typologies ----------------------------------------
    "mcc_abuse_interchange": dict(    # correctly-content-coded, but into a CHEAPER rate band
        weight=0.017, declared=["5411", "5541", "8398", "5812"],
        behaves_as="5967", integrity_category=None, integrity_tier=None,
        monthly_txn=(4.2, 0.80),
        acq_profile=["bank", "psp", "payfac"], n_outlets=(1, 4),
        interchange_abuse=True,
    ),
    "split_ticketing": dict(
        weight=0.020, declared=["5812", "5732", "7011", "5999", "5944"],
        behaves_as=None, integrity_category=None, monthly_txn=(3.7, 0.75),
        acq_profile=["payfac", "psp", "bank"], n_outlets=(1, 4),
        split_ticket=True,
    ),
    "factoring_host": dict(           # small declared business laundering other volume
        weight=0.018, declared=["5261", "5200", "7230", "5812", "7299"],
        behaves_as=None, integrity_category=None, monthly_txn=(2.3, 0.55),
        acq_profile=["payfac", "psp", "offshore"], n_outlets=(1, 2),
        factoring=True,
    ),
    "cash_disbursement": dict(
        weight=0.014, declared=["5999", "7995", "6012", "5944"],
        behaves_as=None, integrity_category="crypto_cash", monthly_txn=(2.9, 0.85),
        acq_profile=["offshore", "psp"], n_outlets=(1, 2),
        quasi_cash=True, cash_disbursement=True,
    ),
    # ---- decoys: score elevated but are NOT integrity violations ----------
    "descriptor_churn_only": dict(
        weight=0.013, declared=["5999", "5399", "5968", "4816"],
        behaves_as=None, integrity_category=None, monthly_txn=(3.9, 0.85),
        acq_profile=["payfac", "psp"], n_outlets=(1, 2),
        descriptor_churn=True,
    ),
}


def _norm_weights():
    total = sum(a["weight"] for a in ARCHETYPES.values())
    return {k: v["weight"] / total for k, v in ARCHETYPES.items()}


SHELL_ARCHETYPES = frozenset({
    "miscoded_gambling", "miscoded_adult", "miscoded_dating_escort",
    "miscoded_crypto_quasicash", "miscoded_cyberlocker", "miscoded_game_of_skill",
    "miscoded_financial_trading", "cash_disbursement",
})


def _corp_name(rng, archetype):
    if archetype in SHELL_ARCHETYPES:
        return f"{rng.choice(SHELL_WORDS)} {rng.choice(SHELL_WORDS)} {rng.choice(SHELL_TAIL)}"
    return f"{rng.choice(CORP_A)} {rng.choice(CORP_B)}"


def _dba_name(rng, corp, mcc):
    grp = MCC_TABLE[mcc][1]
    stem = corp.split()[0]
    if grp in ("Retail F&B",):
        tail = rng.choice(DBA_FOOD)
    elif grp.startswith("Retail"):
        tail = rng.choice(DBA_RETAIL)
    elif grp in ("Digital", "Direct Mktg", "Gambling", "Adult", "Quasi-Cash"):
        tail = rng.choice(DBA_DIGITAL)
    else:
        tail = rng.choice(DBA_SERVICE)
    return f"{stem} {tail}"


def _descriptor_from(dba, city, rng, generic=False):
    if generic:
        return rng.choice(GENERIC_DESCRIPTORS)
    token = "".join(ch for ch in dba.upper() if ch.isalnum() or ch == " ")
    token = token.replace(" ", "*", 1).replace(" ", "")[:22]
    style = rng.random()
    if style < 0.15:
        return f"{token[:16]} {city.upper()[:10]}"
    if style < 0.25:
        return f"WWW.{token.replace('*','')[:14]}.COM"
    if style < 0.32:
        return f"SQ *{token[:18]}"
    return token


def build_universe(rng, n_corps=380):
    """Return (corps, dbas, outlets, acceptance) as lists of dicts."""
    weights = _norm_weights()
    names = list(weights.keys())
    probs = [weights[n] for n in names]

    corps, dbas, outlets, acceptance = [], [], [], []
    corp_seq = dba_seq = out_seq = 0

    acq_by_profile = {}
    for a in ACQUIRERS:
        acq_by_profile.setdefault(a[3], []).append(a)

    for _ in range(n_corps):
        arch_name = rng.choice(names, p=probs)
        arch = ARCHETYPES[arch_name]
        corp_seq += 1
        corp_id = f"CORP{corp_seq:05d}"
        corp_nm = _corp_name(rng, arch_name)

        # incorporation country: shells skew offshore
        if arch_name in SHELL_ARCHETYPES or arch_name == "miscoded_pharma":
            corp_ctry = rng.choice(OFFSHORE_ACQ + ["US", "GB"],
                                   p=[.16, .13, .13, .12, .12, .12, .12, .10])
        else:
            corp_ctry = rng.choice(["US", "US", "US", "US", "GB", "CA", "DE", "AU", "IN"])

        n_dba = 1 if arch.get("dormant") else int(rng.integers(1, 3))
        corps.append(dict(corp_id=corp_id, corp_name=corp_nm,
                          corp_country=corp_ctry, archetype=arch_name))

        for _d in range(n_dba):
            declared_mcc = rng.choice(arch["declared"])
            dba_seq += 1
            dba_id = f"DBA{dba_seq:06d}"
            dba_nm = _dba_name(rng, corp_nm, declared_mcc)
            dbas.append(dict(dba_id=dba_id, corp_id=corp_id, dba_name=dba_nm,
                             declared_mcc=declared_mcc,
                             mcc_description=MCC_TABLE[declared_mcc][0],
                             mcc_group=MCC_TABLE[declared_mcc][1]))

            lo, hi = arch["n_outlets"]
            n_out = int(rng.integers(lo, hi + 1))
            for _o in range(n_out):
                out_seq += 1
                mid = f"MID{out_seq:07d}"
                city, state, zipc = US_CITIES[int(rng.integers(0, len(US_CITIES)))]
                # non-US merchants
                if corp_ctry != "US" and rng.random() < 0.55:
                    mctry = corp_ctry
                    city = {"GB": "London", "CA": "Toronto", "DE": "Berlin", "AU": "Sydney",
                            "IN": "Mumbai", "MT": "Valletta", "CY": "Nicosia", "CW": "Willemstad",
                            "PA": "Panama City", "AE": "Dubai", "PH": "Manila"}.get(corp_ctry, city)
                    state, zipc = "", ""
                else:
                    mctry = "US"

                onboard_month = int(rng.integers(0, 42))  # months before window end
                outlets.append(dict(
                    merchant_id=mid, dba_id=dba_id, corp_id=corp_id,
                    merchant_name=f"{dba_nm} {city}",
                    merchant_city=city, merchant_state=state,
                    merchant_postal=zipc, merchant_country=mctry,
                    declared_mcc=declared_mcc,
                    archetype=arch_name,
                    behaviour_mcc=arch.get("behaves_as") or declared_mcc,
                    integrity_category=arch.get("integrity_category"),
                    integrity_tier=arch.get("integrity_tier"),
                    is_registered=bool(arch.get("registered", False)),
                    split_ticket=bool(arch.get("split_ticket", False)),
                    factoring=bool(arch.get("factoring", False)),
                    descriptor_churn=bool(arch.get("descriptor_churn", False)),
                    quasi_cash=bool(arch.get("quasi_cash", False)),
                    cash_disbursement=bool(arch.get("cash_disbursement", False)),
                    interchange_abuse=bool(arch.get("interchange_abuse", False)),
                    negative_option=bool(arch.get("negative_option", False)),
                    dormant=bool(arch.get("dormant", False)),
                    monthly_txn_mu=arch["monthly_txn"][0],
                    monthly_txn_sigma=arch["monthly_txn"][1],
                    onboard_months_ago=onboard_month,
                    base_descriptor=_descriptor_from(dba_nm, city, rng,
                                                     generic=arch.get("factoring", False)),
                ))

                # acceptance relationships: acquirer BIN + CAID
                prefs = arch["acq_profile"]
                n_rel = 1
                r = rng.random()
                if r > 0.80:
                    n_rel = 2
                if r > 0.96:
                    n_rel = 3
                if arch.get("factoring") or arch.get("split_ticket"):
                    n_rel = max(n_rel, 2)
                chosen = set()
                for _r in range(n_rel):
                    prof = prefs[int(rng.integers(0, len(prefs)))]
                    pool = acq_by_profile[prof]
                    acq = pool[int(rng.integers(0, len(pool)))]
                    abin = acq[2][int(rng.integers(0, len(acq[2])))]
                    if abin in chosen:
                        continue
                    chosen.add(abin)
                    acceptance.append(dict(
                        merchant_id=mid,
                        acquirer_bin=abin,
                        acquirer_name=acq[0],
                        acquirer_country=acq[1],
                        acquirer_profile=acq[3],
                        card_acceptor_id=f"{int(rng.integers(10**10, 10**11)):011d}",
                        terminal_id=f"T{int(rng.integers(10**6, 10**7)):07d}",
                    ))
    return corps, dbas, outlets, acceptance
