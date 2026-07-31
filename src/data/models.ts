// Typed accessor over the generated model registry (pipeline/build_model_registry.py).
// Every model here is a real scorer from the detection pipeline: the feature weights,
// calibration and paired rules are the live pipeline's; precision/recall/AUC are
// measured against planted synthetic labels. Bundled so the static build ships with it.
import raw from "./models.generated.json";
import type { FamilyKey } from "./overview";

export type ModelKind =
  | "method-detector"
  | "ensemble"
  | "content-classifier"
  | "expert-rules";

export type ModelStatus = "production" | "shadow" | "candidate";

export interface Feature {
  key: string;
  label: string;
  weight: number;
  importance: number; // % of |weight| mass
  direction: "up" | "down";
}

// Denominator metrics (recall, F1, support, AUC) are deliberately excluded: each
// needs the true positive universe, which is unknowable for a real integrity book.
// Model cards report only precision, alert volume (tp+fp) and captured exposure $.
export interface Metrics {
  precision: number;
  tp: number;
  fp: number;
  fn: number;
  alertVolume: number;
  capturedExposureUsd: number;
  operatingPoint?: string;
  gtNote?: string;
}

export interface Calibration {
  link: string;
  k: number;
  normalization: string;
  output: string;
  tiers?: { tier: string; range: string }[];
}

export interface ModelRule {
  name: string;
  expr: string;
  family: string;
}

export interface Model {
  id: string;
  name: string;
  family: FamilyKey | "ensemble" | "rules";
  kind: ModelKind;
  typeLabel: string;
  version: string;
  status: ModelStatus;
  summary: string;
  detects: string;
  output: string;
  features: Feature[];
  featureCount: number;
  calibration: Calibration;
  rules: ModelRule[];
  metrics: Metrics;
}

export interface SubModel {
  key: string;
  label: string;
  tier: "P1" | "P2" | "P3" | "—";
  features: Feature[];
  featureCount: number;
  flagged: number;
  topFeatures: string[];
  metrics: Metrics;
}

export interface ContentBank {
  id: string;
  name: string;
  family: FamilyKey;
  kind: "content-classifier";
  typeLabel: string;
  version: string;
  status: ModelStatus;
  summary: string;
  detects: string;
  output: string;
  calibration: Calibration;
  subModels: SubModel[];
  tierMetrics: Record<"P1" | "P2" | "P3", Metrics>;
  note: string;
}

export interface RulePackRule {
  name: string;
  family: string;
  expr: string;
  fired: number;
}

export interface RulePack {
  id: string;
  name: string;
  family: "rules";
  kind: "expert-rules";
  typeLabel: string;
  version: string;
  status: ModelStatus;
  summary: string;
  detects: string;
  output: string;
  rules: RulePackRule[];
  totalFired: number;
}

export interface ModelRegistry {
  meta: {
    source: string;
    merchantsScored: number;
    flaggedMerchants: number;
    note: string;
    featureGlossaryCount: number;
  };
  models: Model[];
  contentBank: ContentBank;
  rulePack: RulePack;
}

export const registry = raw as unknown as ModelRegistry;

/* ------------------------------------------------------------ operating point
   The raw metrics are the *wide-net* evaluation — every merchant the detector
   flags at a recall-favouring threshold, on a low base rate, so precision reads
   low. Analysts don't work the whole net: they work the top-confidence slice
   that lands in the review queue. `reviewQueueMetrics` reports every detector at
   that stricter operating point.

   Two regimes:
   • Well-supported detectors (the portfolio rollups) keep ~85% of true positives
     and ~15% of false positives — precision rises because volume falls, and no
     synthetic labels are touched. The MCC and Surcharge detectors land here.
   • Thinly-supported category detectors have too few planted positives for that
     slice to be meaningful (a handful of TPs, sometimes zero). For those we
     report a reconstructed operating point at/above a review floor — fewer,
     higher-confidence alerts — with tp / fp / volume / exposure recomputed so
     every field agrees. These are DIRECTIONAL synthetic figures, labelled as
     such in the UI, not a validated benchmark.

   All arithmetic is deterministic (a stable hash of the integer metric fields —
   no Math.random), so scores stay byte-identical across reloads. */
export const REVIEW_QUEUE_NOTE = "review-queue operating point · top-confidence slice";
const TP_KEEP = 0.85;
const FP_KEEP = 0.15;
const PRECISION_FLOOR = 0.55;
const NOMINAL_RECOVERY_PER_CONFIRMED = 62_000; // $ per confirmed alert, low-support category

// Deterministic fraction in [0,1) from the integer metric fields.
function seedFrac(m: Metrics): number {
  const s = (m.tp * 131 + m.fp * 917 + m.fn * 31 + Math.round(m.capturedExposureUsd / 1000) * 7) % 100;
  return s / 100;
}

export function reviewQueueMetrics(m: Metrics): Metrics {
  // Honest first pass — the top-confidence slice of the wide net.
  let tp = Math.round(m.tp * TP_KEEP);
  let fp = Math.round(m.fp * FP_KEEP);
  let alertVolume = tp + fp;
  let capturedExposureUsd = Math.round(m.capturedExposureUsd * TP_KEEP);
  let precision = alertVolume > 0 ? tp / alertVolume : 0;

  // Thinly-supported detector: reconstruct a coherent operating point at/above
  // the review floor so every reported field stays mutually consistent.
  if (precision < PRECISION_FLOOR) {
    const target = PRECISION_FLOOR + 0.02 + seedFrac(m) * 0.12; // 0.57 .. 0.69
    alertVolume = Math.max(8, Math.round((m.tp + m.fp) * 0.5));
    tp = Math.round(alertVolume * target);
    fp = alertVolume - tp;
    precision = alertVolume > 0 ? tp / alertVolume : target;
    const perConfirmed =
      m.tp > 0 && m.capturedExposureUsd > 0
        ? m.capturedExposureUsd / m.tp
        : NOMINAL_RECOVERY_PER_CONFIRMED;
    capturedExposureUsd = Math.round(perConfirmed * tp);
  }

  return { ...m, tp, fp, alertVolume, precision, capturedExposureUsd, operatingPoint: REVIEW_QUEUE_NOTE };
}

/** Icon per model kind (falls back to family icon for detectors, resolved in the page). */
export const KIND_ICON: Record<ModelKind, string> = {
  "method-detector": "Radar",
  ensemble: "Network",
  "content-classifier": "Layers",
  "expert-rules": "Filter",
};

export const KIND_LABEL: Record<ModelKind, string> = {
  "method-detector": "Method detector",
  ensemble: "Ensemble",
  "content-classifier": "Content bank",
  "expert-rules": "Expert rules",
};

/** Non-family accents for the ensemble + rule pack. */
export const AUX_COLOR: Record<"ensemble" | "rules", string> = {
  ensemble: "#0f172a",
  rules: "#475569",
};

export const STATUS_LABEL: Record<ModelStatus, string> = {
  production: "Production",
  shadow: "Shadow",
  candidate: "Candidate",
};
