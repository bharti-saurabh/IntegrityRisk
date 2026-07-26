"""Small artifact-loading helper shared by the training/validation scripts."""
from __future__ import annotations

import pandas as pd

from config import ARTIFACT_DIR


def load(name: str) -> pd.DataFrame:
    """Load an artifact written by generate_synthetic_data (parquet or csv)."""
    pq = ARTIFACT_DIR / f"{name}.parquet"
    csv = ARTIFACT_DIR / f"{name}.csv"
    if pq.exists():
        return pd.read_parquet(pq)
    if csv.exists():
        return pd.read_csv(csv)
    raise FileNotFoundError(
        f"{name} artifact not found in {ARTIFACT_DIR}. "
        f"Run: python3 scripts/generate_synthetic_data.py"
    )
