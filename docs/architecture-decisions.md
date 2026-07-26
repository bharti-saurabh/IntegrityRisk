# Architecture & Decision Record

How the Integrity Intelligence Command Center turns a synthetic transaction stream into scored, explainable merchant-integrity risk — and why it's built the way it is.

> All data and entities are synthetic. Outputs are decision-support indicators, not final compliance determinations.

---

## 1. Design constraints

The platform had to satisfy a set of non-negotiables that shaped every decision:

1. **Not a static prototype.** Every surface computes over live data. If you edit an input, the output must change.
2. **Deploys to GitHub Pages.** Static hosting only — no server, no secrets, no jobs.
3. **Works with zero keys.** The public demo must be fully functional with no configuration.
4. **Synthetic data only.** No real PII, card numbers, merchants, investigations, or proprietary rules/thresholds.
5. **Reproducible.** Same seed → byte-identical output, on any machine, on every reload.

These push toward a single architecture: **a deterministic, client-side analytics engine running in a Web Worker.**

## 2. Runtime shape

```
main thread (React UI)  ⇄  Web Worker (data + analytics engine)
     |                             |
     | requests generate/score     | generateDataset(seed)
     |                             | runPipeline(dataset, rules)
     |  records, aggregates,       | computeAggregates / computeModelMetrics
     |  metrics, cases,  ◄─────────| seedCases
     |  bounded txn samples        |
```

- **The worker holds the heavy state** — 120k+ transactions never cross to the main thread. Feature engineering runs on the *full* dataset; only per-merchant records, portfolio aggregates, model metrics, seeded cases, and bounded transaction samples are shipped to the UI.
- **Why a worker:** generating and scoring the portfolio is CPU-heavy. Doing it off the main thread keeps the first paint responsive and the UI interactive while the engine works.

## 3. Determinism

- A **seeded RNG** (mulberry32 over a hashed string seed) replaces `Math.random` everywhere in the generators and models.
- A **fixed data anchor** (`DATA_ANCHOR_MS = 2026-07-01 UTC`) replaces `Date.now()` for all time-relative logic (SLA clocks, recency features, trend windows).
- **Consequence:** the demo is byte-for-byte reproducible. The Vitest suite asserts this directly — regenerating from the same seed yields identical risk scores. It also makes the guided demo and flagship investigations always land on the same recognizable merchants.

## 4. The synthetic data generator

`src/data/generator.ts` builds, from a seed:

- **~1,300 merchants** across MCC categories, each with a declared MCC and a *true* behavioral MCC (usually equal; deliberately divergent for abuse merchants).
- **Customers, cards, devices, IPs** — synthetic tokens only (`C-000001`), never real identifiers.
- **120k+ transactions** whose channel mix, ticket distribution, timing, cash-equivalent markers, and descriptors are drawn from the merchant's *behavioral* profile.
- **Injected typologies** with ground-truth labels for honest evaluation.
- **16 fixed showcase scenarios** — merchant IDs with hand-designed signatures so the demo is always reproducible and covers every typology plus edge cases (cold start, false positive, seasonal, change-point, cross-border mask).

Ground-truth labels (`groundTruthAbuseFlag`, `groundTruthTypology`) exist **only** to compute honest model metrics — they are never fed to the scorer.

## 5. Feature engineering

40+ per-merchant features across families: channel mix, timing/velocity, ticket-size distribution, threshold proximity, cash-equivalent and wallet-load markers, descriptor NLP (entropy, brand-mimic, name similarity, generic-token ratio), refund/dispute behavior, and **peer z-scores grouped by declared MCC** (so "normal" is relative to the category the merchant *claims* to be in). Eighteen of these are surfaced as named, cited contributions (`F-001`…`F-018`).

## 6. The ensemble

Seven components combine into a 0–100 composite (`src/analytics/scoring/ensemble.ts`):

| Component | Weight | What it captures |
| --- | --- | --- |
| Rules | 0.15 | Transparent, editable, per-typology detection rules. |
| Supervised | 0.20 | Learned signal over engineered features. |
| Anomaly | 0.15 | Unsupervised deviation from MCC peers. |
| Graph | 0.15 | Proximity to known-bad entities via shared infrastructure. |
| Descriptor NLP | 0.15 | Brand-mimicry and descriptor deception. |
| MCC mismatch | 0.10 | How far behavior diverges from the declared category. |
| Behavioral change | 0.10 | Change-point / drift in the merchant's own history. |

**Why an explicit weighted ensemble** rather than a single opaque model: explainability. Every score decomposes into named components, and each component decomposes further into SHAP-style feature contributions with both **supporting** and **mitigating** evidence. An analyst can always answer "why is this merchant an 84?"

**Tiers:** `critical ≥80`, `high ≥62`, `elevated ≥45`, `watch ≥28`, else `clear`. The default operating threshold is **62** (deliberately precision-favoring — analyst time is scarce); the Impact Simulator lets you trade precision for recall live.

## 7. MCC prediction

A nearest-behavioral-profile classifier (Gaussian matching + softmax over candidate categories) predicts the MCC the behavior actually resembles, quantifies mismatch severity, and returns ranked candidate probabilities. The flagship MCC Miscoding Studio visualizes declared vs. predicted, a behavioral-fingerprint radar (expected vs. observed across 7 axes), and per-candidate probabilities.

## 8. Graph analytics

Entity resolution over shared settlement accounts, devices, IPs, and owners builds a merchant infrastructure graph. Distance-weighted adjacency to known-bad entities feeds the graph component of the ensemble. The Factoring Explorer renders this as an interactive, deterministically laid-out radial graph.

## 9. The AI copilot

- **Default = deterministic narrative generator.** `generateBrief` / `answerPrompt` draft an investigation brief grounded entirely in the merchant's own evidence, citing feature IDs, and separating supporting from mitigating signals. It handles cold-start merchants explicitly. Because it's deterministic, it needs no key and never hallucinates a figure that isn't in the data.
- **Optional external LLM adapter** (Anthropic/OpenAI/Azure/mock) exists as an interface but is opt-in and never ships with a committed key — satisfying "no API keys in frontend; public demo needs none."

**Guardrail:** the AI flags and cites; it never auto-approves. A named human dispositions every case.

## 10. State & persistence

- **Zustand + `persist`**, single versioned key `iicc-store-v1`.
- **`partialize` persists only light state** — persona, threshold, case patches, rule overrides, demo step, seed. Never the heavy dataset (which is regenerated deterministically) and never base64/blobs (which would blow the `localStorage` quota).
- **Cases persist as patches** merged over the engine's base cases, so investigator edits survive reload while the underlying portfolio stays reproducible.

## 11. Honest evaluation

- Model metrics are computed against the injected ground truth (`computeModelMetrics`): precision, recall, F1, ROC-AUC (trapezoidal over the threshold sweep), PR-AUC, confusion matrix, per-typology precision/recall, and feature importance.
- The Impact Simulator recomputes precision/recall/workload/captured-exposure across the *full* record set as the threshold moves — no proxy, no hardcoded numbers.
- We **do not fake precision on synthetic data.** Outputs are labeled directional decision-support throughout.

## 12. Testing

`tests/engine.test.ts` (Vitest) asserts the acceptance criteria directly: ≥100k transactions, 1,000–5,000 merchants, all showcase scenarios present, synthetic-only card tokens, scores in `[0,100]`, abuse merchants scoring above clean ones, MCC recovery on the flagship, usable precision + ROC-AUC, byte-identical determinism across regeneration, and aggregate consistency.

## 13. Deployment

GitHub Actions ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) type-checks, tests, builds, and publishes to Pages. The Vite base is derived from the repo name at build time. `HashRouter` keeps deep links working on static hosting. **A red build never deploys.**

## Decision log (trade-offs at a glance)

| Decision | Alternative rejected | Why |
| --- | --- | --- |
| Web Worker engine | Score on main thread | 120k txns would jank the UI; worker keeps first paint fast. |
| Deterministic seeded RNG | `Math.random` | Reproducibility is a hard requirement; enables determinism tests. |
| Explicit weighted ensemble | Single black-box model | Explainability — every score decomposes to cited features. |
| Deterministic AI narrative | LLM-only copilot | Zero-key public demo; no hallucinated figures; still swappable. |
| Persist patches, not full state | Persist everything | Avoids `localStorage` quota blowups; keeps portfolio reproducible. |
| Regenerate data client-side | Ship a data file | Keeps the repo free of large synthetic dumps; seed is the source of truth. |
