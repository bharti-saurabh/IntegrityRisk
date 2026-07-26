// Typed accessor over the generated multi-family anatomy data (pipeline/build_anatomy_data.py).
// One real (synthetic) flagged exemplar per integrity family. Peer z-scores, the composite
// decomposition, the rule-threshold panels and every signature view (interchange band, split
// bursts, sub-merchant fan-out, descriptor rotation, cash histogram) are the live pipeline's.
// No PII, no card numbers. Bundled so the keyboard scene deck ships inside the static build.
//
// Honesty note baked into the shape: only mcc_miscoding is model-routed and carries a content
// `fingerprint`. The other five are rule-routed — their score scene shows a rule-threshold
// panel (`ruleChecks`) instead of the composite decomposition.
import raw from "./anatomy.generated.json";

export type FamilyKey =
  | "mcc_miscoding" | "mcc_abuse" | "split_ticketing"
  | "factoring" | "descriptor" | "cash";

export type TellTag =
  | "night" | "round" | "cnp" | "offshore" | "declined"
  | "recurring" | "cpmismatch" | "ceiling" | "burst" | "submerchant" | "big";

export interface AnatomyTxn {
  time: string;
  hour: number;
  amount: number;
  channel: string;
  cardPresent: boolean;
  issuer: string;
  acquirer: string;
  approved: boolean;
  authDesc: string;
  descriptor: string;
  tells: TellTag[];
}

export interface Deviation {
  key: string;
  label: string;
  plainLabel: string;
  kind: "pct" | "usd" | "num" | "bps";
  value: number;
  z: number;
  baseline: number | null;
  baselineLabel: string | null;
  multiple: number | null;
  hot: boolean;
}

export interface Edu {
  tagline: string;
  definition: string;
  analogy: string;
  mechanic: string[];
  cost: string;
  legitTwin: string;
  victim: string;
}

export interface Identity {
  merchantId: string;
  name: string;
  corp: string;
  city: string;
  country: string;
  declaredMcc: string;
  declaredAs: string;
  mccGroup: string;
  txnCount: number;
  grossSalesUsd: number;
  activeDays: number;
}

export interface Driver {
  key: string;
  label: string;
  z: number;
  weight: number;
  contribution: number;
  share: number;
}

export interface RuleCheck {
  label: string;
  col: string;
  actual: number;
  op: ">" | "≥" | "<" | "≤";
  threshold: number;
  kind: "pct" | "usd" | "num" | "bps";
  pass: boolean;
}

export interface AnatomyScore {
  integrityRiskScore: number;
  compositeZ: number;
  reconstructedZ: number;
  percentile: number;
  tier: string;
  exposureWeighted: number;
  patternScore: number;
  patternLabel: string;
  routedBy: "model" | "rule" | "both";
  flagReason: string;
  drivers: Driver[];
  ruleChecks: { rule: string; ruleLabel: string; mode: string; checks: RuleCheck[] } | null;
  tierBins: { tier: string; range: string }[];
}

export interface FiredRule {
  name: string;
  label: string;
  expr: string;
  plain: string;
}

// ---- per-family signature payloads (discriminated on `kind`) ----------------
export interface SigFingerprint {
  kind: "fingerprint";
  entries: { key: string; label: string; tier: "P1" | "P2" | "P3" | "—"; score: number; isTop: boolean }[];
  lit: number;
}
export interface SigInterchange {
  kind: "interchange";
  declaredBps: number;
  expectedBps: number;
  effectiveBps: number;
  advantageBps: number;
  cnpVsExpected: number;
  grossUsd: number;
  leakedFeesUsd: number;
}
export interface SigSplit {
  kind: "split";
  ceiling: number;
  bursts: { start: string; size: number; total: number; amounts: number[] }[];
  nearCeilingPct: number;
  burstEvents: number;
  avgGapSec: number;
}
export interface SigFactoring {
  kind: "factoring";
  declared: string;
  nSub: number;
  subs: { id: string; descriptor: string; txns: number; volume: number }[];
  spikeRatio: number;
  pctViaSub: number;
  monthly: { month: string; volume: number }[];
}
export interface SigDescriptor {
  kind: "descriptor";
  changes: number;
  jaccard: number;
  distinct: number;
  chargebackBps: number;
  descriptors: { name: string; firstSeen: string; txns: number; share: number }[];
}
export interface SigCash {
  kind: "cash";
  roundShare: number;
  quasiShare: number;
  gt500Share: number;
  avgTicket: number;
  histogram: { label: string; count: number; round: boolean }[];
  roundHits: { amount: number; count: number }[];
}
export type Signature =
  | SigFingerprint | SigInterchange | SigSplit | SigFactoring | SigDescriptor | SigCash;

export interface FamilyVerdict {
  declaredMcc: string;
  declaredAs: string;
  behavesAs: string;
  familyLabel: string;
  priorityTier: "P1" | "P2" | "P3" | "—";
  riskTier: string;
  routedBy: "model" | "rule" | "both";
  firingRule: string;
  exposure: number;
  rulesTriggered: number;
  trueArchetype: string;
}

export interface AnatomyFamily {
  key: FamilyKey;
  label: string;
  color: string;
  icon: string;
  route: string;
  edu: Edu;
  identity: Identity;
  tells: { tag: TellTag; why: string }[];
  transactions: AnatomyTxn[];
  deviations: Deviation[];
  signature: Signature;
  score: AnatomyScore;
  rules: FiredRule[];
  verdict: FamilyVerdict;
}

export interface AnatomyDoc {
  meta: { source: string; note: string };
  families: AnatomyFamily[];
}

export const anatomy = raw as unknown as AnatomyDoc;

export const TELL_META: Record<TellTag, { label: string; color: string }> = {
  night: { label: "Night hour", color: "#7c3aed" },
  round: { label: "Round amount", color: "#d97706" },
  cnp: { label: "Card-not-present", color: "#2563eb" },
  offshore: { label: "Offshore acquirer", color: "#e11d48" },
  declined: { label: "Declined", color: "#dc2626" },
  recurring: { label: "Recurring-flagged", color: "#0891b2" },
  cpmismatch: { label: "Card-present mismatch", color: "#9333ea" },
  ceiling: { label: "Near ceiling", color: "#d97706" },
  burst: { label: "Split burst", color: "#ea580c" },
  submerchant: { label: "Sub-merchant", color: "#e11d48" },
  big: { label: "Large clean ticket", color: "#0f766e" },
};

// Short inline glossary surfaced by the explainer tray (learner feedback).
export const GLOSSARY: { term: string; def: string }[] = [
  { term: "MCC", def: "Merchant Category Code — the 4-digit code that says what a business sells and sets its fees and scrutiny." },
  { term: "Acquirer", def: "The bank that signs up the merchant and settles its card sales." },
  { term: "Issuer", def: "The bank that gave the cardholder their card and carries the fraud risk." },
  { term: "Interchange", def: "The per-sale fee the acquirer pays the issuer, set by the category and how the card was used." },
  { term: "bps", def: "Basis points — hundredths of a percent. 50 bps = 0.50% of the sale." },
  { term: "CNP", def: "Card-not-present — an online or phone sale with no physical card." },
  { term: "Chargeback", def: "A cardholder dispute that reverses a charge; too many put a merchant under monitoring." },
  { term: "Descriptor", def: "The billing name a customer sees on their statement." },
  { term: "Offshore acquirer", def: "Settlement routed through a bank in a third country the declared business has no reason to use." },
];

export const families = anatomy.families;
export function familyByKey(k: string): AnatomyFamily | undefined {
  return anatomy.families.find((f) => f.key === k);
}
