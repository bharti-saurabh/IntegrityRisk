# Model Card — MCC Behavioral Classifier

> Demonstration model trained on synthetic data. Outputs are decision-support indicators, not final compliance determinations.

## Overview

- **Name:** MCC Behavioral Classifier
- **Purpose:** Predict the merchant category code (MCC) that a merchant's transaction *behavior* most resembles, so it can be compared against the MCC the merchant *declared*. A large declared-vs-predicted gap is the core signal for MCC miscoding.
- **Where it runs:** The live demo runs a deterministic nearest-behavioral-profile variant (Gaussian match + softmax) client-side in a Web Worker. The offline reference (`scripts/train_mcc_model.py`) is a multinomial logistic regression that documents the same idea with standard tooling.
- **Version / reproducibility:** Deterministic from seed `20260701` (offline) / `iicc-demo-v1` (browser). Same seed → same model.

## Intended use

- **Intended:** Surface merchants whose behavior diverges from their declared category for analyst review; power the MCC Miscoding Studio's declared-vs-predicted view, candidate probabilities, and behavioral-fingerprint radar.
- **Not intended:** Automated category reassignment, automated enforcement, or any final determination. The model flags; a named human decides.

## Inputs / features

Per-merchant behavioral aggregates only — no identity or protected attributes:
`avg_ticket`, `std_ticket`, `cash_share`, `card_present_share`, `refund_rate`, `threshold_proximity`. In the browser engine these expand to a richer fingerprint (channel mix, timing, cash-equivalent markers, descriptor NLP).

## Labels

Trained against the merchant's *true behavioral* MCC (from the synthetic generator). Ground-truth abuse flags are used only to measure the mismatch signal — never as a model input.

## Metrics (synthetic, directional)

Reported by the training script on a held-out 25% split: top-1 and top-3 accuracy, portfolio-wide declared≠predicted rate, and the mismatch signal's recall on true-abuse merchants vs. its false-positive rate on clean merchants. Exact values are printed on each run and written to `artifacts/mcc_model.json`; they are directional because the data is synthetic.

## Limitations & ethics

- **Synthetic data.** Real merchant behavior is noisier; treat all metrics as directional.
- **No protected attributes or proxies.** Features are behavioral/needs-based only — never age, race, sex, marital status, ZIP, or similar.
- **Category overlap.** Legitimate merchants can straddle categories (e.g., seasonal spikes); a single mismatch is a lead, not a conclusion. The ensemble and a human analyst provide the surrounding judgment.
- **Decision-support only.** No auto-approval, no auto-reassignment.
