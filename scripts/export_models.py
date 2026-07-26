"""Bundle the trained model artifacts into a single portable JSON.

Produces scripts/artifacts/models_bundle.json — a self-describing, key-free
export (coefficients, scalers, metrics, feature lists) that documents exactly
what the offline reference models learned. No secrets, no pickles (which are
neither portable nor safe to load untrusted); everything is plain JSON.

Usage:  python3 scripts/export_models.py
"""
from __future__ import annotations

import json

from config import SEED, ARTIFACT_DIR, ENSEMBLE_WEIGHTS, TIER_THRESHOLDS


def _read(name: str) -> dict | None:
    path = ARTIFACT_DIR / name
    if not path.exists():
        print(f"[export] warning: {name} missing — run the trainer first.")
        return None
    return json.loads(path.read_text())


def main() -> None:
    bundle = {
        "schema": "iicc.models/v1",
        "seed": SEED,
        "ensemble_weights": ENSEMBLE_WEIGHTS,
        "tier_thresholds": {name: lo for name, lo in TIER_THRESHOLDS},
        "mcc_model": _read("mcc_model.json"),
        "integrity_model": _read("integrity_model.json"),
        "notes": (
            "Reference export of the offline analogue models. The browser demo "
            "runs an equivalent deterministic engine client-side and does not "
            "load this file. No API keys or secrets are included."
        ),
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = ARTIFACT_DIR / "models_bundle.json"
    out.write_text(json.dumps(bundle, indent=2))
    print(f"[export] wrote {out} "
          f"({'mcc ok' if bundle['mcc_model'] else 'mcc MISSING'}, "
          f"{'integrity ok' if bundle['integrity_model'] else 'integrity MISSING'})")


if __name__ == "__main__":
    main()
