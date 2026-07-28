import type { MerchantRiskRecord, Typology } from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { round } from "@/utils/stats";
import { exposureForRecord } from "@/analytics/aggregates";

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

// Denominator metrics (recall, F1, PR-AUC, ROC-AUC) are deliberately excluded:
// each requires the true universe of positives, which is unknowable in a real
// integrity book (undetected abuse is, by definition, uncounted). We report only
// what a synthetic ground-truth flag can honestly support against the alerts we
// actually raise — precision, alert volume / workload, and captured exposure ($).
export interface ThresholdPoint {
  threshold: number;
  precision: number;
  alerts: number;
  capturedExposure: number;
}

export interface ModelMetrics {
  threshold: number;
  precision: number;
  alertVolume: number;
  capturedExposureUsd: number;
  confusion: ConfusionMatrix;
  curve: ThresholdPoint[];
  byTypology: { typology: Typology; label: string; precision: number; alerts: number }[];
  featureImportance: { id: string; label: string; importance: number }[];
  falsePositives: string[];
}

// Ground-truth is available because the data is synthetic. Metrics are computed
// against the abuse flag using the ensemble final score as the classifier.
export function confusionAt(records: MerchantRiskRecord[], threshold: number): ConfusionMatrix {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const r of records) {
    const positive = r.scores.finalRiskScore >= threshold;
    const actual = r.merchant.groundTruthAbuseFlag;
    if (positive && actual) tp++;
    else if (positive && !actual) fp++;
    else if (!positive && actual) fn++;
    else tn++;
  }
  return { tp, fp, tn, fn };
}

function precisionOf(c: ConfusionMatrix): number {
  return c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0;
}

// Captured exposure = the exposure $ carried by true-positive alerts at a
// threshold — the dollars the model actually surfaces for review.
function capturedExposureAt(records: MerchantRiskRecord[], threshold: number): number {
  let sum = 0;
  for (const r of records) {
    if (r.scores.finalRiskScore >= threshold && r.merchant.groundTruthAbuseFlag) {
      sum += exposureForRecord(r);
    }
  }
  return sum;
}

export function computeModelMetrics(
  records: MerchantRiskRecord[],
  threshold = 62,
): ModelMetrics {
  const curve: ThresholdPoint[] = [];
  for (let t = 0; t <= 100; t += 2) {
    const c = confusionAt(records, t);
    curve.push({
      threshold: t,
      precision: round(precisionOf(c), 4),
      alerts: c.tp + c.fp,
      capturedExposure: round(capturedExposureAt(records, t), 0),
    });
  }

  const c = confusionAt(records, threshold);
  const precision = precisionOf(c);

  // Per-typology precision + alert volume (predicted primary vs ground-truth typology).
  const typologies: Typology[] = ["MCC_MISCODING", "MCC_ABUSE", "SPLIT_TICKETING", "FACTORING", "CARD_SURCHARGE", "CASH_DISBURSEMENT"];
  const byTypology = typologies.map((typ) => {
    let tp = 0,
      fp = 0;
    for (const r of records) {
      const predicted = r.scores.finalRiskScore >= threshold && r.primaryTypology === typ;
      const actual = r.merchant.groundTruthTypology === typ;
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
    }
    return {
      typology: typ,
      label: TYPOLOGY_LABELS[typ],
      precision: round(tp + fp > 0 ? tp / (tp + fp) : 0, 3),
      alerts: tp + fp,
    };
  });

  // Feature importance = mean absolute contribution across flagged merchants.
  const impMap = new Map<string, { label: string; sum: number; n: number }>();
  for (const r of records) {
    if (r.scores.finalRiskScore < threshold) continue;
    for (const fc of r.topFeatures) {
      const e = impMap.get(fc.id) ?? { label: fc.label, sum: 0, n: 0 };
      e.sum += Math.abs(fc.contribution);
      e.n++;
      impMap.set(fc.id, e);
    }
  }
  const featureImportance = [...impMap.entries()]
    .map(([id, v]) => ({ id, label: v.label, importance: round(v.sum / Math.max(v.n, 1), 2) }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 12);

  const falsePositives = records
    .filter((r) => r.scores.finalRiskScore >= threshold && !r.merchant.groundTruthAbuseFlag)
    .slice(0, 12)
    .map((r) => r.merchant.merchantId);

  return {
    threshold,
    precision: round(precision, 4),
    alertVolume: c.tp + c.fp,
    capturedExposureUsd: round(capturedExposureAt(records, threshold), 0),
    confusion: c,
    curve,
    byTypology,
    featureImportance,
    falsePositives,
  };
}
