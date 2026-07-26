import type {
  MerchantFeatures,
  MccPrediction,
  RuleHit,
  RiskScoreBreakdown,
  FeatureContribution,
  RiskTier,
  Typology,
} from "@/types/domain";
import { clamp, logistic100, round } from "@/utils/stats";

// Ensemble weights (§9). Each component is normalized to 0..100.
export const ENSEMBLE_WEIGHTS = {
  rule: 0.15,
  supervised: 0.2,
  anomaly: 0.15,
  graph: 0.15,
  descriptorNlp: 0.15,
  mccMismatch: 0.1,
  behavioralChange: 0.1,
} as const;

function ruleScore(ruleHits: RuleHit[]): number {
  return clamp(ruleHits.reduce((a, h) => a + h.score, 0));
}

// Transparent logistic "supervised" model — a fixed linear combination of the
// most predictive features standing in for the exported gradient-boosted model.
function supervisedScore(f: MerchantFeatures): number {
  const z =
    -3.2 +
    2.6 * f.mccDivergence +
    1.8 * f.cashEquivalentRatio +
    1.4 * f.cardNotPresentRatio * f.nightRatio * 3 +
    1.2 * f.roundDollarRatio +
    1.1 * f.thresholdProximityRatio +
    0.9 * f.walletLoadRatio +
    0.7 * f.notRecognizedDisputeRate * 10;
  return logistic100(z, 1, 0);
}

function anomalyScore(f: MerchantFeatures): number {
  const zmag = Math.abs(f.peerNightZ) + Math.abs(f.peerCnpZ) + Math.abs(f.peerTicketZ);
  return clamp(logistic100(zmag - 2.5, 0.9, 0) * 0.7 + f.mccDivergence * 40);
}

function descriptorNlpScore(f: MerchantFeatures): number {
  return clamp(
    100 *
      (0.4 * f.brandMimicScore +
        0.2 * Math.min(1, f.descriptorEntropy / 2.2) +
        0.15 * f.genericTokenRatio +
        0.15 * (1 - f.descriptorNameSimilarity) +
        0.1 * Math.min(1, f.notRecognizedDisputeRate * 20)),
  );
}

function mccMismatchScore(mcc: MccPrediction, f: MerchantFeatures): number {
  const base: Record<RiskTier, number> = {
    critical: 90,
    high: 72,
    elevated: 55,
    watch: 30,
    clear: 6,
  };
  const b = base[mcc.mismatchSeverity];
  return clamp(0.7 * b + 0.3 * (mcc.confidence * 100) * (mcc.mismatchSeverity === "clear" ? 0 : 1) + f.mccDivergence * 10);
}

export function tierFor(score: number): RiskTier {
  if (score >= 80) return "critical";
  if (score >= 62) return "high";
  if (score >= 45) return "elevated";
  if (score >= 28) return "watch";
  return "clear";
}

export function computeScores(
  f: MerchantFeatures,
  mcc: MccPrediction,
  ruleHits: RuleHit[],
  graphScore: number,
): RiskScoreBreakdown {
  const rule = ruleScore(ruleHits);
  const supervised = supervisedScore(f);
  const anomaly = anomalyScore(f);
  const descriptor = descriptorNlpScore(f);
  const mismatch = mccMismatchScore(mcc, f);
  const change = clamp(f.changePointScore * 100);
  const w = ENSEMBLE_WEIGHTS;
  const final = clamp(
    w.rule * rule +
      w.supervised * supervised +
      w.anomaly * anomaly +
      w.graph * graphScore +
      w.descriptorNlp * descriptor +
      w.mccMismatch * mismatch +
      w.behavioralChange * change,
  );
  return {
    ruleScore: round(rule, 1),
    supervisedScore: round(supervised, 1),
    anomalyScore: round(anomaly, 1),
    graphScore: round(graphScore, 1),
    descriptorNlpScore: round(descriptor, 1),
    mccMismatchScore: round(mismatch, 1),
    behavioralChangeScore: round(change, 1),
    finalRiskScore: round(final, 1),
    tier: tierFor(final),
  };
}

// ---- Explainability: SHAP-style feature contributions ---------------------

interface FeatureSpec {
  id: string;
  key: keyof MerchantFeatures;
  label: string;
  weight: number; // contribution scale
  format: (v: number) => string;
  /** Maps raw feature value → [0,1] intensity. */
  intensity: (v: number) => number;
  raises: boolean;
}

const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`;
const numFmt = (v: number) => v.toFixed(2);
const cur = (v: number) => `$${v.toFixed(0)}`;

const FEATURE_SPECS: FeatureSpec[] = [
  { id: "F-001", key: "mccDivergence", label: "Declared-MCC behavioral divergence", weight: 26, format: numFmt, intensity: (v) => Math.min(1, v / 0.6), raises: true },
  { id: "F-002", key: "cardNotPresentRatio", label: "Card-not-present ratio", weight: 16, format: pctFmt, intensity: (v) => v, raises: true },
  { id: "F-003", key: "nightRatio", label: "Overnight transaction ratio", weight: 15, format: pctFmt, intensity: (v) => Math.min(1, v / 0.6), raises: true },
  { id: "F-004", key: "cashEquivalentRatio", label: "Cash-equivalent ratio", weight: 20, format: pctFmt, intensity: (v) => Math.min(1, v * 1.5), raises: true },
  { id: "F-005", key: "roundDollarRatio", label: "Round-dollar ratio", weight: 14, format: pctFmt, intensity: (v) => v, raises: true },
  { id: "F-006", key: "refundAfterPurchaseRatio", label: "Refund-after-purchase ratio", weight: 14, format: pctFmt, intensity: (v) => Math.min(1, v * 1.5), raises: true },
  { id: "F-007", key: "thresholdProximityRatio", label: "Near-threshold ticket ratio", weight: 15, format: pctFmt, intensity: (v) => Math.min(1, v * 1.5), raises: true },
  { id: "F-008", key: "walletLoadRatio", label: "Wallet-load ratio", weight: 15, format: pctFmt, intensity: (v) => Math.min(1, v * 1.5), raises: true },
  { id: "F-009", key: "descriptorEntropy", label: "Descriptor entropy", weight: 13, format: numFmt, intensity: (v) => Math.min(1, v / 2.2), raises: true },
  { id: "F-010", key: "brandMimicScore", label: "Brand-mimic similarity", weight: 16, format: numFmt, intensity: (v) => v, raises: true },
  { id: "F-011", key: "notRecognizedDisputeRate", label: "'Not recognized' dispute rate", weight: 14, format: pctFmt, intensity: (v) => Math.min(1, v * 15), raises: true },
  { id: "F-012", key: "crossBorderRatio", label: "Cross-border ratio", weight: 10, format: pctFmt, intensity: (v) => v, raises: true },
  { id: "F-013", key: "sharedBankAccountCount", label: "Shared settlement accounts", weight: 16, format: (v) => `${v}`, intensity: (v) => Math.min(1, v / 4), raises: true },
  { id: "F-014", key: "submerchantCount", label: "Undisclosed submerchant count", weight: 14, format: (v) => `${v}`, intensity: (v) => Math.min(1, v / 8), raises: true },
  { id: "F-015", key: "changePointScore", label: "Behavioral change-point", weight: 12, format: numFmt, intensity: (v) => v, raises: true },
  { id: "F-016", key: "avgTicket", label: "Average ticket", weight: 6, format: cur, intensity: (v) => Math.min(1, v / 500), raises: true },
  { id: "F-017", key: "repeatCardRatio", label: "Repeat-card concentration", weight: 9, format: pctFmt, intensity: (v) => v, raises: true },
  { id: "F-018", key: "descriptorNameSimilarity", label: "Descriptor↔legal-name match", weight: 10, format: pctFmt, intensity: (v) => 1 - v, raises: false },
];

export function computeFeatureContributions(f: MerchantFeatures): FeatureContribution[] {
  const contribs: FeatureContribution[] = FEATURE_SPECS.map((spec) => {
    const value = f[spec.key] as number;
    const intensity = spec.intensity(value);
    const signed = spec.raises ? spec.weight * intensity : -spec.weight * (1 - intensity);
    return {
      id: spec.id,
      label: spec.label,
      value,
      display: spec.format(value),
      contribution: round(signed, 2),
      direction: Math.abs(signed) < 1 ? "neutral" : signed > 0 ? "raises" : "lowers",
    };
  });
  return contribs
    .filter((c) => Math.abs(c.contribution) >= 1)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// Per-typology scores so the portfolio can attribute a primary typology.
export function computeTypologyScores(
  f: MerchantFeatures,
  mcc: MccPrediction,
  ruleHits: RuleHit[],
  graphScore: number,
): Record<Exclude<Typology, "CLEAN">, number> {
  const ruleByTypology = (t: Typology) =>
    clamp(ruleHits.filter((h) => h.typology === t).reduce((a, h) => a + h.score, 0));

  const mccScore = clamp(
    0.5 * (mcc.mismatchSeverity === "clear" ? 0 : 100) * mcc.confidence +
      40 * f.mccDivergence +
      0.4 * ruleByTypology("MCC_MISCODING"),
  );
  const splitScore = clamp(
    100 * (0.55 * f.thresholdProximityRatio + 0.45 * Math.min(1, f.rapidRepeatRatio * 4)) +
      0.5 * ruleByTypology("SPLIT_TICKETING"),
  );
  const factoringScore = clamp(
    0.5 * graphScore +
      100 * (0.3 * Math.min(1, f.descriptorEntropy / 2.2) + 0.2 * Math.min(1, f.categoryDiversity / 2)) +
      0.5 * ruleByTypology("FACTORING"),
  );
  const descriptorScore = clamp(
    100 * (0.5 * f.brandMimicScore + 0.3 * Math.min(1, f.notRecognizedDisputeRate * 15)) +
      0.5 * ruleByTypology("FAKE_DESCRIPTOR"),
  );
  const cashScore = clamp(
    100 * (0.4 * f.roundDollarRatio + 0.3 * Math.min(1, f.walletLoadRatio * 1.5) + 0.3 * Math.min(1, f.refundAfterPurchaseRatio * 1.5)) +
      0.5 * ruleByTypology("CASH_DISBURSEMENT"),
  );
  return {
    MCC_MISCODING: round(mccScore, 1),
    SPLIT_TICKETING: round(splitScore, 1),
    FACTORING: round(factoringScore, 1),
    FAKE_DESCRIPTOR: round(descriptorScore, 1),
    CASH_DISBURSEMENT: round(cashScore, 1),
  };
}

export function primaryTypologyFrom(
  scores: Record<Exclude<Typology, "CLEAN">, number>,
  finalRisk: number,
): Typology {
  if (finalRisk < 28) return "CLEAN";
  let best: Typology = "MCC_MISCODING";
  let bestVal = -1;
  (Object.entries(scores) as [Exclude<Typology, "CLEAN">, number][]).forEach(([k, v]) => {
    if (v > bestVal) {
      bestVal = v;
      best = k;
    }
  });
  return best;
}
