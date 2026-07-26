# Model Card — Integrity Risk Ensemble

> Demonstration model trained on synthetic data. Outputs are decision-support indicators, not final compliance determinations.

## Overview

- **Name:** Integrity Risk Ensemble
- **Purpose:** Produce a 0–100 composite integrity-risk score per merchant with a full, explainable decomposition, so analysts can triage MCC miscoding, split-ticketing, factoring, descriptor deception, and cash-disbursement abuse.
- **Where it runs:** The live demo blends seven components client-side (see weights below) with SHAP-style feature attributions. The offline reference (`scripts/train_integrity_models.py`) fits the *supervised component* as a gradient-boosted classifier and reports the same precision/recall/ROC/PR family the Model Observatory shows.
- **Version / reproducibility:** Deterministic from seed `20260701` (offline) / `iicc-demo-v1` (browser).

## Composition & weights

| Component | Weight | Signal |
| --- | --- | --- |
| Rules | 0.15 | Transparent, editable per-typology detection rules. |
| Supervised | 0.20 | Learned signal over engineered features (this card's trained model). |
| Anomaly | 0.15 | Unsupervised deviation from MCC peers. |
| Graph | 0.15 | Proximity to known-bad entities via shared infrastructure. |
| Descriptor NLP | 0.15 | Brand-mimicry and descriptor deception. |
| MCC mismatch | 0.10 | Divergence from the declared category (see the MCC classifier card). |
| Behavioral change | 0.10 | Change-point / drift in the merchant's own history. |

**Tiers:** `critical ≥80`, `high ≥62`, `elevated ≥45`, `watch ≥28`, else `clear`. Default operating threshold **62** — deliberately precision-favoring; the Impact Simulator trades precision for recall live.

## Inputs / features

Per-merchant behavioral aggregates: `txn_count`, `avg_ticket`, `std_ticket`, `cash_share`, `card_present_share`, `refund_rate`, `threshold_proximity` (offline set; the browser uses 40+). No identity or protected attributes.

## Labels & evaluation

Ground-truth abuse flags from the synthetic generator are used to fit the supervised head and to evaluate. Reported metrics (held-out 30% split): precision, recall, F1 at the operating threshold, ROC-AUC, PR-AUC, a full threshold sweep, and feature importance — written to `artifacts/integrity_model.json`.

## Explainability

Every score decomposes into its seven weighted components, and each component into named, cited feature contributions with both **supporting** and **mitigating** evidence. An analyst can always answer "why is this merchant an 84?" The AI copilot narrates this decomposition and cites feature IDs; it never invents figures and never auto-approves.

## Limitations & ethics

- **Synthetic data → directional metrics.** Do not read precision/recall as production performance.
- **Precision-favoring by design.** The default threshold minimizes analyst workload at the cost of recall; the Impact Simulator makes the tradeoff explicit rather than hiding it.
- **No protected attributes or proxies.** Behavioral/needs-based features only.
- **Human-in-the-loop.** The ensemble triages and explains; a named investigator dispositions every case with an audit trail.
- **Not a final determination.** Outputs are decision-support indicators only.
