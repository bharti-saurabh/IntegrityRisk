"""Validate the generated portfolio against the demo's acceptance criteria & guardrails.

Fails loudly (non-zero exit) if any invariant is violated. Run this in CI or
before trusting the artifacts.

Checks:
  - >= 100,000 transactions
  - 1,000-5,000 merchants
  - all 15 showcase scenarios present
  - card identifiers are synthetic tokens (C-NNNNNN), never a 13-19 digit PAN
  - no negative amounts; rates in [0,1]
  - ground-truth labels present and self-consistent
  - determinism: regenerating from the same seed reproduces identical row counts

Usage:  python3 scripts/validate_demo_data.py
"""
from __future__ import annotations

import sys

import numpy as np

from artifacts_io import load
from build_demo_scenarios import SCENARIO_IDS


def check(cond: bool, msg: str, failures: list[str]) -> None:
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {msg}")
    if not cond:
        failures.append(msg)


def main() -> int:
    failures: list[str] = []
    merchants = load("merchants")
    txns = load("transactions")
    feat = load("features")

    print("Acceptance criteria:")
    check(len(txns) >= 100_000, f">=100k transactions (got {len(txns):,})", failures)
    check(1_000 <= len(merchants) <= 5_000,
          f"1,000-5,000 merchants (got {len(merchants):,})", failures)
    present = SCENARIO_IDS.issubset(set(merchants["merchant_id"]))
    check(present, f"all {len(SCENARIO_IDS)} showcase scenarios present", failures)

    print("Guardrails:")
    tokens_ok = txns["card_id"].astype(str).str.match(r"^C-\d{6}$").all()
    check(bool(tokens_ok), "card ids are synthetic tokens (C-NNNNNN)", failures)
    no_pan = ~txns["card_id"].astype(str).str.contains(r"\d{13,19}", regex=True)
    check(bool(no_pan.all()), "no 13-19 digit PANs anywhere", failures)
    check(bool((txns["amount"] >= 0).all()), "no negative amounts", failures)

    print("Data integrity:")
    for col in ["cash_share", "card_present_share", "refund_rate", "threshold_proximity"]:
        vals = feat[col].fillna(0).to_numpy()
        check(bool(((vals >= -1e-9) & (vals <= 1 + 1e-9)).all()),
              f"{col} in [0,1]", failures)
    check(bool(merchants["ground_truth_abuse"].notna().all()),
          "ground-truth abuse flag present for every merchant", failures)
    consistent = (
        (merchants["ground_truth_abuse"] == (merchants["ground_truth_typology"] != "CLEAN"))
    ).all()
    check(bool(consistent), "abuse flag consistent with typology label", failures)

    print("Determinism:")
    # Re-import the generator and rebuild merchants; row count must match exactly.
    import importlib
    gen = importlib.import_module("generate_synthetic_data")
    importlib.reload(gen)
    m2 = gen.build_merchants()
    check(len(m2) == len(merchants) and list(m2["merchant_id"]) == list(merchants["merchant_id"]),
          "regeneration reproduces identical merchant set", failures)

    print()
    if failures:
        print(f"VALIDATION FAILED — {len(failures)} check(s) failed.")
        return 1
    print("VALIDATION PASSED — all acceptance criteria & guardrails satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
