# Offline reference pipeline (Python)

A standalone, runnable analogue of the in-browser analytics engine. **The web demo
does not depend on any of this** — it exists to document the offline version of the
same method (synthetic data → features → MCC & integrity models → validation) and to
provide model artifacts and cards.

Everything is deterministic from a single `SEED` in [`config.py`](config.py). No
wall-clock time or unseeded randomness enters any generator or model. No real PII,
card numbers, merchants, or proprietary data — card identifiers are synthetic tokens
(`C-000001`), never PANs.

## Setup

```bash
pip install -r scripts/requirements.txt
```

## Run the whole pipeline

```bash
python3 scripts/generate_synthetic_data.py   # -> artifacts/{merchants,transactions,features}
python3 scripts/build_demo_scenarios.py       # print the 15 showcase scenarios
python3 scripts/train_mcc_model.py            # -> artifacts/mcc_model.json
python3 scripts/train_integrity_models.py     # -> artifacts/integrity_model.json
python3 scripts/export_models.py              # -> artifacts/models_bundle.json
python3 scripts/validate_demo_data.py         # asserts acceptance criteria + guardrails
```

`npm run generate:data` and `npm run train:models` are convenience aliases for the
first and fourth steps.

## Files

| Script | Purpose |
| --- | --- |
| `config.py` | Shared constants: seed, MCC profiles, ensemble weights, tiers. Mirrors the TS engine. |
| `build_demo_scenarios.py` | The 15 fixed showcase scenarios (declared vs. actual MCC + edge cases). |
| `generate_synthetic_data.py` | Deterministic merchant/transaction/feature generator (≥100k txns). |
| `train_mcc_model.py` | MCC classifier — predicts the category the behavior resembles; mismatch analysis. |
| `train_integrity_models.py` | Supervised integrity head + precision/recall/ROC-AUC/PR-AUC + threshold sweep. |
| `export_models.py` | Bundles trained artifacts into a portable, key-free JSON. |
| `validate_demo_data.py` | Fails loudly if any acceptance criterion or guardrail is violated. |

## Model cards

- [`docs/model-cards/mcc-classifier.md`](../docs/model-cards/mcc-classifier.md)
- [`docs/model-cards/integrity-ensemble.md`](../docs/model-cards/integrity-ensemble.md)

## Relationship to the browser engine

The TypeScript engine under `src/analytics/` is the source of truth for the live
demo; it runs entirely client-side in a Web Worker. This Python pipeline reproduces
the same *conceptual* stages with standard data-science tooling (numpy / pandas /
scikit-learn) so the method is legible to reviewers who prefer notebooks over
TypeScript. Numbers will not be byte-identical between the two (different RNG
substrate and model families), but both are deterministic within themselves and tell
the same story: declared MCC vs. behavioral MCC drives the integrity signal.
