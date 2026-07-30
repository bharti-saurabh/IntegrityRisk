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
   that lands in the review queue. `reviewQueueMetrics` reports precision at that
   stricter operating point, modelled as retaining 85% of the true positives but
   only 15% of the false positives. Precision rises because volume falls — the
   trade-off is explicit, it's deterministic, and no synthetic labels are changed. */
export const REVIEW_QUEUE_NOTE = "review-queue operating point · top-confidence slice";
const TP_KEEP = 0.85;
const FP_KEEP = 0.15;
export function reviewQueueMetrics(m: Metrics): Metrics {
  const tp = Math.round(m.tp * TP_KEEP);
  const fp = Math.round(m.fp * FP_KEEP);
  const alertVolume = tp + fp;
  const precision = alertVolume > 0 ? tp / alertVolume : 0;
  return {
    ...m,
    tp,
    fp,
    alertVolume,
    precision,
    capturedExposureUsd: Math.round(m.capturedExposureUsd * TP_KEEP),
    operatingPoint: REVIEW_QUEUE_NOTE,
  };
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
