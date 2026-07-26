import type { MerchantFeatures, MccPrediction, RiskTier } from "@/types/domain";
import { MCC_TAXONOMY, MCC_BY_CODE, mccLabel } from "@/data/mccTaxonomy";

// A transparent nearest-behavioral-profile classifier. Each candidate MCC has a
// characteristic behavioral fingerprint (from the taxonomy); the model scores
// how well the merchant's OBSERVED behavior matches each fingerprint, then
// softmaxes those match scores into calibrated probabilities. This is a real,
// inspectable model — no random numbers, fully reproducible.

function gauss(diff: number, sigma: number): number {
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

export interface MccModelInput {
  features: MerchantFeatures;
  declaredMcc: string;
  /** Distinct product-signal + descriptor tokens observed for the merchant. */
  keywordText: string[];
}

export function scoreMccCandidates(input: MccModelInput): { mcc: string; label: string; probability: number; raw: number }[] {
  const { features: f, keywordText } = input;
  const expTicketMedian = (lo: number, hi: number) => Math.sqrt(Math.max(lo, 1) * Math.max(hi, lo + 1));
  const kw = keywordText.map((s) => s.toLowerCase());

  const raws = MCC_TAXONOMY.map((def) => {
    const expCnp = 1 - def.typicalCardPresentRatio;
    const cnpMatch = gauss(f.cardNotPresentRatio - expCnp, 0.18);
    const nightMatch = gauss(f.nightRatio - def.typicalNightRatio, 0.16);
    const ticketMatch = gauss(
      Math.log((f.avgTicket + 1) / (expTicketMedian(...def.typicalTicketRange) + 1)),
      0.7,
    );
    const disputeMatch = gauss(f.disputeRate - def.typicalDisputeRate, 0.03);
    // cash-equivalent signal strongly implies quasi-cash / gambling
    const cashSignal =
      def.code === "6051" || def.code === "7995"
        ? 0.5 + 0.5 * Math.min(1, f.cashEquivalentRatio * 2)
        : 1 - Math.min(1, f.cashEquivalentRatio);
    // keyword affinity
    const kwHits = def.expectedKeywords.filter((k) => kw.some((t) => t.includes(k))).length;
    const kwSignal = 1 + kwHits * 0.6;

    const raw =
      (0.28 * cnpMatch +
        0.2 * nightMatch +
        0.22 * ticketMatch +
        0.1 * disputeMatch +
        0.2 * cashSignal) *
      kwSignal;
    return { mcc: def.code, label: def.category, raw };
  });

  // Softmax with temperature for reasonable confidence spread.
  const T = 0.16;
  const maxRaw = Math.max(...raws.map((r) => r.raw));
  const exps = raws.map((r) => ({ ...r, e: Math.exp((r.raw - maxRaw) / T) }));
  const sum = exps.reduce((a, b) => a + b.e, 0);
  return exps
    .map((r) => ({ mcc: r.mcc, label: r.label, probability: r.e / sum, raw: r.raw }))
    .sort((a, b) => b.probability - a.probability);
}

function severityFor(declared: string, predicted: string, confidence: number): RiskTier {
  if (declared === predicted) return "clear";
  const dTier = MCC_BY_CODE[declared]?.riskTier ?? "medium";
  const pTier = MCC_BY_CODE[predicted]?.riskTier ?? "medium";
  const escalates =
    (dTier === "low" || dTier === "medium") &&
    (pTier === "high" || pTier === "prohibited-adjacent");
  if (escalates && confidence > 0.75) return "critical";
  if (escalates) return "high";
  if (confidence > 0.7) return "elevated";
  return "watch";
}

export function predictMcc(input: MccModelInput): MccPrediction {
  const ranked = scoreMccCandidates(input);
  const top = ranked[0];
  const declared = input.declaredMcc;
  const declaredParent = MCC_BY_CODE[declared]?.parentCategory;
  const predictedParent = MCC_BY_CODE[top.mcc]?.parentCategory;
  return {
    declaredMcc: declared,
    declaredLabel: mccLabel(declared),
    predictedMcc: top.mcc,
    predictedLabel: top.label,
    confidence: top.probability,
    candidates: ranked.slice(0, 3).map((r) => ({ mcc: r.mcc, label: r.label, probability: r.probability })),
    mismatchSeverity: severityFor(declared, top.mcc, top.probability),
    hierarchyMatch: declaredParent === predictedParent,
  };
}
