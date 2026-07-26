# Integrity Intelligence Command Center

**Detecting MCC miscoding, merchant laundering, and category-code abuse through data, machine learning, graph intelligence, and AI.**

A fully client-side, deployable demonstration of a merchant-integrity risk platform. It generates a large synthetic transaction portfolio in the browser, engineers behavioral features, scores every merchant with a transparent ensemble, predicts the merchant category code (MCC) the behavior *actually* resembles, resolves entity graphs, and drafts grounded, citable investigation briefs — all with **no backend, no API keys, and no real data**.

> **Demonstration environment. All data and entities are synthetic. Outputs are decision-support indicators, not final compliance determinations.**

---

## Why this exists

Merchants sometimes register under one MCC but transact like another business — to dodge monitoring, launder volume for a third party, or disguise cash disbursement as retail. This app shows, end to end, how a network-integrity team could surface that behavior:

- **Data → features → models → explanation → case**, with every number traceable to the merchant's own evidence.
- **Nothing is hardcoded.** Filters recalculate, the threshold live-re-scores metrics, toggling a rule re-scores the whole portfolio in a worker, case edits persist, and exports emit real files.

## What's in the box

| Area | What it does |
| --- | --- |
| **Executive Command Center** | Portfolio risk trend, tier distribution, exposure by typology, top-risk merchants. |
| **Merchant Universe** | Searchable / sortable / filterable table over the full portfolio; CSV export. |
| **Typology Hub** | Five detection modules with live alert counts, exposure, and confidence. |
| **MCC Miscoding Studio** *(flagship)* | Declared vs. predicted MCC, behavioral-fingerprint radar, candidate probabilities, SHAP-style attributions. |
| **Split-Ticketing Lab** | Amount histogram with the monitoring-threshold reference line; reconstructed transaction clusters. |
| **Factoring Explorer** | Entity-resolution graph over shared banks / devices / IPs / owners with known-bad adjacency. |
| **Descriptor Intelligence** | Brand-mimicry, descriptor entropy, and "merchant not recognized" dispute analysis. |
| **Cash-Disbursement** | Cash-equivalent, wallet-load, round-dollar, and refund-abuse composition. |
| **Investigation Workspace** | Evidence column + AI copilot that drafts a brief grounded in feature-ID citations. |
| **Case Queue** | Master-detail case management with SLA, dispositions, notes, audit trail (persists to `localStorage`). |
| **Model Observatory** | Precision/recall/F1, ROC & PR curves, confusion matrix, feature importance, per-typology metrics. |
| **Impact Simulator** | A threshold slider that live-computes precision, recall, workload, and captured exposure. |
| **Rules Engine** | Detection rules are data — toggle one and the portfolio re-scores. |
| **Architecture** | The pipeline, ensemble weights, guardrails, and reproducibility notes. |

Plus a **command palette (⌘K / Ctrl-K)**, **four personas** (executive, analyst, data scientist, operations), and an **8-step guided demo**.

## Guardrails (built in, not bolted on)

- **Synthetic data only** — no real PII, card numbers, merchants, investigations, or proprietary rules/thresholds.
- **Card identifiers are synthetic tokens** (`C-000001`) and are masked in the UI (`•••• 8294`). Never a real PAN.
- **No API keys in frontend code.** The public demo runs with zero configuration. An optional LLM adapter exists but is opt-in and never ships with a committed key — the default AI copilot is a deterministic, grounded narrative generator.
- **Decision-support, not authority** — the AI flags and cites; a named human signs off.
- **Reproducible** — the entire portfolio is generated from a fixed seed with a deterministic RNG. No `Math.random` or wall-clock time enters the generators or models, so the same seed always yields byte-identical merchants, transactions, scores, and metrics.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

The dataset (~1,300 merchants, 120k+ transactions) is generated in a Web Worker on first load; the UI streams in as it completes.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server. |
| `npm run build` | Type-check (`tsc -b`) then production build. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Type-check only (`tsc -b --noEmit`). |
| `npm test` | Run the Vitest suite (data volume, determinism, metrics sanity). |

## Deploying to GitHub Pages

1. Push to `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source = "GitHub Actions."**
3. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) type-checks, tests, builds, and deploys.

The Vite `base` defaults to `/integrity-intelligence-command-center/` and the workflow overrides it to `/<repo-name>/` automatically, so forks deploy without edits. Routing uses `HashRouter`, so deep links work on static hosting.

## Tech stack

React 18 · TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`) · Vite · Tailwind · Zustand (persist) · react-router-dom (HashRouter) · Recharts · lucide-react. Heavy chart code is lazy-loaded so it tree-shakes out of the main bundle. The data + analytics engine runs in a Web Worker; only records, aggregates, metrics, cases, and bounded transaction samples cross to the main thread.

## How scoring works (short version)

Seven components combine into a 0–100 composite:

| Component | Weight |
| --- | --- |
| Rules | 15% |
| Supervised | 20% |
| Anomaly | 15% |
| Graph | 15% |
| Descriptor NLP | 15% |
| MCC mismatch | 10% |
| Behavioral change | 10% |

Each merchant carries SHAP-style feature contributions (18 named features, `F-001`…`F-018`) and a tier (`critical ≥80`, `high ≥62`, `elevated ≥45`, `watch ≥28`, else `clear`). See [`docs/architecture-decisions.md`](docs/architecture-decisions.md) for the full method and the rationale behind each choice.

## Optional Python deliverables

The browser engine is self-contained, but a parallel Python reference implementation lives under [`scripts/`](scripts/) (synthetic data generation, MCC and integrity model training, model export, validation, scenario builder) with model cards under [`docs/model-cards/`](docs/model-cards/). These document the offline analogue of the in-browser pipeline; the demo does not depend on them.

## Repository layout

```
src/
  app/          app shell, nav, command palette, persona switcher, guided demo
  analytics/    features, rules, ensemble scoring, MCC model, graph, model metrics, cases
  data/         deterministic synthetic data generator, scenarios, MCC taxonomy
  pages/        the 14 screens
  stores/       Zustand store (persisted)
  components/   UI primitives + chart kit
  types/        domain types
tests/          Vitest suite
docs/           architecture decisions + model cards
scripts/        optional Python reference pipeline
.github/        Pages deploy workflow
```
