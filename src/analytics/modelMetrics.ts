import type { MerchantRiskRecord, Typology } from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { round } from "@/utils/stats";

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface ThresholdPoint {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  alerts: number;
  tpr: number;
  fpr: number;
}

export interface ModelMetrics {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  rocAuc: number;
  prAuc: number;
  confusion: ConfusionMatrix;
  curve: ThresholdPoint[];
  byTypology: { typology: Typology; label: string; precision: number; recall: number; support: number }[];
  featureImportance: { id: string; label: string; importance: number }[];
  falsePositives: string[];
  falseNegatives: string[];
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

function prf(c: ConfusionMatrix) {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

export function computeModelMetrics(
  records: MerchantRiskRecord[],
  threshold = 62,
): ModelMetrics {
  const curve: ThresholdPoint[] = [];
  const positives = records.filter((r) => r.merchant.groundTruthAbuseFlag).length;
  const negatives = records.length - positives;
  for (let t = 0; t <= 100; t += 2) {
    const c = confusionAt(records, t);
    const { precision, recall, f1 } = prf(c);
    curve.push({
      threshold: t,
      precision: round(precision, 4),
      recall: round(recall, 4),
      f1: round(f1, 4),
      alerts: c.tp + c.fp,
      tpr: positives ? round(c.tp / positives, 4) : 0,
      fpr: negatives ? round(c.fp / negatives, 4) : 0,
    });
  }

  // ROC-AUC via trapezoidal integration over the threshold sweep.
  const rocPts = [...curve].sort((a, b) => a.fpr - b.fpr);
  let rocAuc = 0;
  for (let i = 1; i < rocPts.length; i++) {
    rocAuc += ((rocPts[i].fpr - rocPts[i - 1].fpr) * (rocPts[i].tpr + rocPts[i - 1].tpr)) / 2;
  }
  // PR-AUC via trapezoid over recall.
  const prPts = [...curve].sort((a, b) => a.recall - b.recall);
  let prAuc = 0;
  for (let i = 1; i < prPts.length; i++) {
    prAuc += ((prPts[i].recall - prPts[i - 1].recall) * (prPts[i].precision + prPts[i - 1].precision)) / 2;
  }

  const c = confusionAt(records, threshold);
  const { precision, recall, f1 } = prf(c);

  // Per-typology precision/recall (predicted primary vs ground-truth typology).
  const typologies: Typology[] = ["MCC_MISCODING", "MCC_ABUSE", "SPLIT_TICKETING", "FACTORING", "FAKE_DESCRIPTOR", "CASH_DISBURSEMENT"];
  const byTypology = typologies.map((typ) => {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const r of records) {
      const predicted = r.scores.finalRiskScore >= threshold && r.primaryTypology === typ;
      const actual = r.merchant.groundTruthTypology === typ;
      if (predicted && actual) tp++;
      else if (predicted && !actual) fp++;
      else if (!predicted && actual) fn++;
    }
    return {
      typology: typ,
      label: TYPOLOGY_LABELS[typ],
      precision: round(tp + fp > 0 ? tp / (tp + fp) : 0, 3),
      recall: round(tp + fn > 0 ? tp / (tp + fn) : 0, 3),
      support: tp + fn,
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
  const falseNegatives = records
    .filter((r) => r.scores.finalRiskScore < threshold && r.merchant.groundTruthAbuseFlag)
    .slice(0, 12)
    .map((r) => r.merchant.merchantId);

  return {
    threshold,
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(f1, 4),
    rocAuc: round(rocAuc, 4),
    prAuc: round(prAuc, 4),
    confusion: c,
    curve,
    byTypology,
    featureImportance,
    falsePositives,
    falseNegatives,
  };
}
