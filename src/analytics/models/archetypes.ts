import type {
  MerchantFeatures,
  ArchetypeMatch,
  ArchetypeAttribution,
} from "@/types/domain";
import { MCC_BY_CODE } from "@/data/mccTaxonomy";

// ---------------------------------------------------------------------------
// Behavioral-archetype model.
//
// We are NOT predicting the "correct" MCC. We are measuring how closely a
// merchant's OBSERVED behavior matches the behavioral signature of a known
// high-risk operator type. Each archetype is anchored to a canonical MCC and
// defined by a small set of discriminative axes (the variables that actually
// separate that operator type from ordinary retail). For each axis we compute
// a match in [0,1]; the archetype similarity is the weighted average, and each
// axis's share of that weighted sum is its attribution — a transparent,
// reproducible "why this looks like an adult / gambling / pharma operator".
// ---------------------------------------------------------------------------

function gauss(diff: number, sigma: number): number {
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const cur = (v: number) => `$${Math.round(v)}`;

type Fmt = (v: number) => string;

interface Axis {
  id: string; // shares the FeatureContribution id space
  key: keyof MerchantFeatures;
  label: string;
  target: number; // expected value for a genuine operator of this type
  sigma: number; // tolerance
  weight: number; // discriminative importance
  fmt: Fmt;
  /** true when "the higher, the more like this archetype" (exceeding target = full match). */
  monotone?: boolean;
}

export interface ArchetypeDef {
  key: string;
  label: string;
  short: string;
  anchorMcc: string;
  /** product-signal / descriptor tokens that corroborate this archetype. */
  keywords: string[];
  rationale: string;
  axes: Axis[];
}

// Archetypes a MISCODED merchant may resemble. Anchors:
//   7273 dating/escort · 7995 betting/casino · 5967 direct-mktg (nutra/pharma) · 6051 quasi-cash/crypto
export const MISCODING_ARCHETYPES: ArchetypeDef[] = [
  {
    key: "adult",
    label: "Adult & dating operator",
    short: "Adult",
    anchorMcc: "7273",
    keywords: ["dating", "match", "companions", "social", "adult", "cam", "escort"],
    rationale:
      "Overnight, fully card-not-present volume with elevated 'I don't recognize this' disputes — the signature of adult & dating services declared as something benign.",
    axes: [
      { id: "F-002", key: "cardNotPresentRatio", label: "Card-not-present ratio", target: 0.98, sigma: 0.12, weight: 18, fmt: pct, monotone: true },
      { id: "F-003", key: "nightRatio", label: "Overnight transaction ratio", target: 0.55, sigma: 0.18, weight: 22, fmt: pct, monotone: true },
      { id: "F-011", key: "notRecognizedDisputeRate", label: "'Not recognized' dispute rate", target: 0.05, sigma: 0.03, weight: 20, fmt: pct, monotone: true },
      { id: "D-DIS", key: "disputeRate", label: "Overall dispute rate", target: 0.06, sigma: 0.035, weight: 14, fmt: pct, monotone: true },
      { id: "F-017", key: "repeatCardRatio", label: "Repeat-card concentration", target: 0.5, sigma: 0.25, weight: 10, fmt: pct, monotone: true },
    ],
  },
  {
    key: "gambling",
    label: "Gambling & betting operator",
    short: "Gambling",
    anchorMcc: "7995",
    keywords: ["bet", "casino", "wager", "poker", "slots", "gaming", "stake", "odds"],
    rationale:
      "Late-night, high-ticket card-not-present flow with cash-equivalent and round-dollar loading — how online betting books behave when miscoded into retail.",
    axes: [
      { id: "F-004", key: "cashEquivalentRatio", label: "Cash-equivalent ratio", target: 0.35, sigma: 0.2, weight: 20, fmt: pct, monotone: true },
      { id: "F-003", key: "nightRatio", label: "Overnight transaction ratio", target: 0.55, sigma: 0.18, weight: 18, fmt: pct, monotone: true },
      { id: "F-005", key: "roundDollarRatio", label: "Round-dollar ratio", target: 0.45, sigma: 0.22, weight: 16, fmt: pct, monotone: true },
      { id: "F-002", key: "cardNotPresentRatio", label: "Card-not-present ratio", target: 0.98, sigma: 0.12, weight: 12, fmt: pct, monotone: true },
      { id: "F-016", key: "avgTicket", label: "Average ticket", target: 260, sigma: 220, weight: 12, fmt: cur, monotone: true },
    ],
  },
  {
    key: "pharma",
    label: "Unlicensed pharma / nutra operator",
    short: "Pharma",
    anchorMcc: "5967",
    keywords: ["rx", "pharma", "pill", "med", "supplement", "wellness", "membership", "trial", "nutra"],
    rationale:
      "Recurring card-not-present billing with high refund-after-purchase and cross-border settlement — consistent with unlicensed pharma / nutraceutical 'free-trial' billing.",
    axes: [
      { id: "F-006", key: "refundAfterPurchaseRatio", label: "Refund-after-purchase ratio", target: 0.25, sigma: 0.15, weight: 20, fmt: pct, monotone: true },
      { id: "F-002", key: "cardNotPresentRatio", label: "Card-not-present ratio", target: 0.98, sigma: 0.12, weight: 14, fmt: pct, monotone: true },
      { id: "F-011", key: "notRecognizedDisputeRate", label: "'Not recognized' dispute rate", target: 0.05, sigma: 0.03, weight: 18, fmt: pct, monotone: true },
      { id: "F-012", key: "crossBorderRatio", label: "Cross-border ratio", target: 0.4, sigma: 0.25, weight: 16, fmt: pct, monotone: true },
      { id: "F-017", key: "repeatCardRatio", label: "Recurring-card concentration", target: 0.55, sigma: 0.22, weight: 12, fmt: pct, monotone: true },
    ],
  },
  {
    key: "crypto",
    label: "Crypto / quasi-cash operator",
    short: "Crypto",
    anchorMcc: "6051",
    keywords: ["crypto", "coin", "wallet", "exchange", "topup", "load", "token", "btc", "usdt"],
    rationale:
      "Wallet-load and cash-equivalent flow at high tickets with near-total card-not-present share — the fingerprint of a crypto / quasi-cash desk hiding under a retail code.",
    axes: [
      { id: "F-004", key: "cashEquivalentRatio", label: "Cash-equivalent ratio", target: 0.5, sigma: 0.22, weight: 22, fmt: pct, monotone: true },
      { id: "F-008", key: "walletLoadRatio", label: "Wallet-load ratio", target: 0.4, sigma: 0.2, weight: 20, fmt: pct, monotone: true },
      { id: "F-002", key: "cardNotPresentRatio", label: "Card-not-present ratio", target: 1.0, sigma: 0.12, weight: 12, fmt: pct, monotone: true },
      { id: "F-016", key: "avgTicket", label: "Average ticket", target: 450, sigma: 350, weight: 12, fmt: cur, monotone: true },
      { id: "F-005", key: "roundDollarRatio", label: "Round-dollar ratio", target: 0.4, sigma: 0.22, weight: 10, fmt: pct, monotone: true },
    ],
  },
];

function axisMatch(axis: Axis, value: number): number {
  if (axis.monotone && value >= axis.target) return 1;
  return gauss(value - axis.target, axis.sigma);
}

function scoreOne(def: ArchetypeDef, f: MerchantFeatures, kw: string[]): ArchetypeMatch {
  const scored = def.axes.map((axis) => {
    const value = f[axis.key] as number;
    const m = axisMatch(axis, value);
    return { axis, value, m, wm: axis.weight * m };
  });
  const wsum = scored.reduce((a, s) => a + s.axis.weight, 0);
  const wmsum = scored.reduce((a, s) => a + s.wm, 0);
  let similarity = wmsum / wsum; // 0..1

  // Keyword / descriptor corroboration nudges similarity up (never down).
  const kwHits = def.keywords.filter((k) => kw.some((t) => t.includes(k))).length;
  if (kwHits > 0) similarity = similarity + (1 - similarity) * Math.min(0.35, kwHits * 0.12);

  const attributions: ArchetypeAttribution[] = scored
    .map((s) => ({
      id: s.axis.id,
      label: s.axis.label,
      observed: s.axis.fmt(s.value),
      expected: s.axis.monotone ? `≥ ${s.axis.fmt(s.axis.target)}` : `~ ${s.axis.fmt(s.axis.target)}`,
      match: Number(s.m.toFixed(3)),
      share: wmsum > 0 ? Number((s.wm / wmsum).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.share - a.share);

  const def_ = MCC_BY_CODE[def.anchorMcc];
  return {
    key: def.key,
    label: def.label,
    short: def.short,
    similarity: Number((similarity * 100).toFixed(1)),
    anchorMcc: def.anchorMcc,
    anchorLabel: def_?.category ?? `MCC ${def.anchorMcc}`,
    riskTier: def_?.riskTier ?? "high",
    rationale: def.rationale,
    attributions,
  };
}

/**
 * Rank how closely a merchant behaves like each known high-risk operator type.
 * Returns descending by similarity. `keywordText` = product-signal + descriptor tokens.
 */
export function scoreArchetypes(
  f: MerchantFeatures,
  keywordText: string[],
  defs: ArchetypeDef[] = MISCODING_ARCHETYPES,
): ArchetypeMatch[] {
  const kw = keywordText.map((s) => s.toLowerCase());
  return defs.map((d) => scoreOne(d, f, kw)).sort((a, b) => b.similarity - a.similarity);
}
