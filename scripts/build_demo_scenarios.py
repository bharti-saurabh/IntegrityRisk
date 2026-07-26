"""Define the fixed showcase scenarios for the offline pipeline.

These mirror the 15 named scenarios in src/data/scenarios.ts: merchants with a
declared MCC that differs from the category their behavior actually resembles,
plus edge cases (cold start, false positive, seasonal, change-point). Ground
truth here exists only to evaluate models honestly — it is never fed to a scorer.

Run standalone to print the scenario table; imported by generate_synthetic_data.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import json


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    merchant_id: str
    title: str
    declared_mcc: str
    actual_mcc: str  # the behavior the transactions are generated from
    primary_typology: str
    story: str
    # generation overrides layered on the actual-MCC profile
    threshold_avoid: float = 0.0
    round_dollar: float = 0.0
    wallet_load: float = 0.0
    refund_after: float = 0.0
    brand_mimic: str = ""
    shared_infra: bool = False
    change_point: bool = False
    seasonal: bool = False
    cold_start: bool = False
    false_positive: bool = False
    cross_border_mask: bool = False


SCENARIOS: list[Scenario] = [
    Scenario("SC-01", "M-EDGEWATER-GROCER", "Grocer transacting like crypto quasi-cash",
             "5411", "6051", "MCC_MISCODING",
             "Registered as a grocery store but 70% cash-equivalent, huge tickets, card-not-present."),
    Scenario("SC-02", "M-BOARDWALK-CAFE", "Restaurant laundering gambling volume",
             "5812", "7995", "MCC_MISCODING",
             "Cafe MCC, but betting-shaped tickets and CNP mix."),
    Scenario("SC-03", "M-SUMMIT-ELECTRONICS", "Electronics store split-ticketing under threshold",
             "5732", "5732", "SPLIT_TICKETING",
             "Legitimate MCC, but rapid repeat charges clustered just under the monitoring threshold.",
             threshold_avoid=0.6),
    Scenario("SC-04", "M-HARBOR-SUPPLY", "Supply co. factoring for a third party",
             "5999", "4829", "FACTORING",
             "Retail MCC, money-transfer behavior, shared settlement bank with known-bad entities.",
             shared_infra=True),
    Scenario("SC-05", "M-AURORA-BOUTIQUE", "Brand-mimic descriptor deception",
             "5999", "5967", "FAKE_DESCRIPTOR",
             "Descriptor mimics a well-known brand; elevated 'merchant not recognized' disputes.",
             brand_mimic="AMZN-PRIME-STORE"),
    Scenario("SC-06", "M-MERIDIAN-WALLET", "Cash disbursement via wallet loads",
             "5999", "6051", "CASH_DISBURSEMENT",
             "Round-dollar wallet loads dominate; near-zero refunds; card-not-present.",
             wallet_load=0.65, round_dollar=0.55),
    Scenario("SC-07", "M-LAKESIDE-VAPE", "Vape shop drifting into quasi-cash mid-window",
             "5993", "6051", "MCC_MISCODING",
             "Behavior change-points halfway through the window into quasi-cash.",
             change_point=True),
    Scenario("SC-08", "M-COBALT-TRANSFER", "Money transfer masking cross-border flow",
             "4829", "4829", "FACTORING",
             "Legitimate MCC but cross-border settlement masked through domestic descriptors.",
             cross_border_mask=True, shared_infra=True),
    Scenario("SC-09", "M-PINE-DATING", "Dating service with refund-after-load abuse",
             "7273", "7273", "CASH_DISBURSEMENT",
             "High refund-after-load ratio consistent with disbursement abuse.",
             refund_after=0.4),
    Scenario("SC-10", "M-GRANITE-MARKET", "Split-ticketing grocer",
             "5411", "5411", "SPLIT_TICKETING",
             "Grocer with repeated same-card charges just below threshold.",
             threshold_avoid=0.5),
    Scenario("SC-11", "M-VERTEX-ESHOP", "Descriptor churn across many sub-descriptors",
             "5999", "5967", "FAKE_DESCRIPTOR",
             "High descriptor entropy — dozens of alternate descriptors."),
    Scenario("SC-12", "M-SOLSTICE-GIFTS", "Seasonal legitimate spike (NOT abuse)",
             "5999", "5999", "MCC_MISCODING",  # ground-truth clean; tests false-positive control
             "Seasonal volume spike that naive models flag; should resolve to clear.",
             seasonal=True, false_positive=True),
    Scenario("SC-13", "M-NEWLEAF-STARTUP", "Cold-start merchant, sparse history",
             "5812", "5812", "MCC_MISCODING",
             "Too few transactions to score confidently; copilot must say so.",
             cold_start=True),
    Scenario("SC-14", "M-IRONGATE-GAMING", "Gambling coded as electronics",
             "5732", "7995", "MCC_MISCODING",
             "Electronics MCC, gambling behavior, large CNP tickets."),
    Scenario("SC-15", "M-DELTA-REMIT", "Factoring ring hub sharing devices/IPs",
             "5999", "4829", "FACTORING",
             "Central node in a factoring ring; shared devices and IPs with several merchants.",
             shared_infra=True),
]

# Sanity: ground-truth abuse flag is true unless explicitly a false-positive control.
SCENARIO_IDS = {s.merchant_id for s in SCENARIOS}


def ground_truth_flag(s: Scenario) -> bool:
    return not s.false_positive


if __name__ == "__main__":
    rows = []
    for s in SCENARIOS:
        rows.append({
            "merchant_id": s.merchant_id,
            "declared_mcc": s.declared_mcc,
            "actual_mcc": s.actual_mcc,
            "typology": s.primary_typology,
            "abuse": ground_truth_flag(s),
            "title": s.title,
        })
    print(json.dumps(rows, indent=2))
    print(f"\n{len(SCENARIOS)} showcase scenarios "
          f"({sum(ground_truth_flag(s) for s in SCENARIOS)} abusive, "
          f"{sum(not ground_truth_flag(s) for s in SCENARIOS)} clean control).")
