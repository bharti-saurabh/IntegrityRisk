"""Shared configuration for the offline reference pipeline.

This mirrors the constants baked into the in-browser TypeScript engine so the
Python analogue produces conceptually equivalent, reproducible output. The web
demo does NOT read any of this — it is a documentation/reference deliverable.

Everything is deterministic: a single integer SEED drives all randomness. No
wall-clock time enters any generator or model.
"""
from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------
SEED = 20260701  # matches the demo's fixed data anchor (2026-07-01)
ARTIFACT_DIR = Path(__file__).parent / "artifacts"

# ---------------------------------------------------------------------------
# Portfolio shape (kept small enough to run in seconds; scale N_MERCHANTS up
# to match the browser's ~1,300 merchants / 120k transactions if desired)
# ---------------------------------------------------------------------------
N_MERCHANTS = 1300
TARGET_TRANSACTIONS = 120_000
WINDOW_DAYS = 60
ABUSE_PREVALENCE = 0.14  # among non-scenario merchants
MONITORING_THRESHOLD = 500.0  # $ threshold for split/threshold logic

# ---------------------------------------------------------------------------
# Typologies (must match src/types/domain.ts)
# ---------------------------------------------------------------------------
TYPOLOGIES = [
    "MCC_MISCODING",
    "SPLIT_TICKETING",
    "FACTORING",
    "FAKE_DESCRIPTOR",
    "CASH_DISBURSEMENT",
]

# ---------------------------------------------------------------------------
# Ensemble weights (must match src/analytics/scoring/ensemble.ts)
# ---------------------------------------------------------------------------
ENSEMBLE_WEIGHTS = {
    "rule": 0.15,
    "supervised": 0.20,
    "anomaly": 0.15,
    "graph": 0.15,
    "descriptorNlp": 0.15,
    "mccMismatch": 0.10,
    "behavioralChange": 0.10,
}

# ---------------------------------------------------------------------------
# Risk tiers (must match tierFor() in the TS scoring module)
# ---------------------------------------------------------------------------
TIER_THRESHOLDS = [
    ("critical", 80),
    ("high", 62),
    ("elevated", 45),
    ("watch", 28),
    ("clear", 0),
]
DEFAULT_OPERATING_THRESHOLD = 62

# ---------------------------------------------------------------------------
# A compact MCC taxonomy subset with typical behavioral profiles. Each profile
# is (cash_share, avg_ticket, card_present_share, refund_rate). These seed the
# generator and give the MCC classifier something to match behavior against.
# ---------------------------------------------------------------------------
MCC_PROFILES = {
    "5411": {"label": "Grocery Stores", "cash": 0.02, "ticket": 68.0, "cp": 0.86, "refund": 0.01},
    "5812": {"label": "Eating Places / Restaurants", "cash": 0.03, "ticket": 42.0, "cp": 0.90, "refund": 0.01},
    "5732": {"label": "Electronics Stores", "cash": 0.01, "ticket": 220.0, "cp": 0.55, "refund": 0.06},
    "5999": {"label": "Miscellaneous Retail", "cash": 0.04, "ticket": 55.0, "cp": 0.50, "refund": 0.04},
    "7995": {"label": "Betting / Gambling", "cash": 0.35, "ticket": 180.0, "cp": 0.10, "refund": 0.02},
    "6051": {"label": "Quasi-Cash / Crypto", "cash": 0.70, "ticket": 320.0, "cp": 0.05, "refund": 0.01},
    "4829": {"label": "Money Transfer", "cash": 0.55, "ticket": 260.0, "cp": 0.08, "refund": 0.01},
    "5967": {"label": "Direct Marketing / Inbound Tele", "cash": 0.02, "ticket": 45.0, "cp": 0.02, "refund": 0.12},
    "7273": {"label": "Dating / Escort Services", "cash": 0.05, "ticket": 60.0, "cp": 0.01, "refund": 0.09},
    "5993": {"label": "Cigar Stores / Vape", "cash": 0.15, "ticket": 35.0, "cp": 0.70, "refund": 0.02},
}


def tier_for(score: float) -> str:
    """Map a 0-100 composite score to a risk tier (matches the TS engine)."""
    for name, lo in TIER_THRESHOLDS:
        if score >= lo:
            return name
    return "clear"
