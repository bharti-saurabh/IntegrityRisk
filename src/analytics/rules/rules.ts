import type { MerchantFeatures, MerchantProfile, RuleHit, Typology } from "@/types/domain";
import { mccLabel } from "@/data/mccTaxonomy";

export type Operator = ">" | ">=" | "<" | "<=" | "==" | "in" | "not-in";

export interface RuleCondition {
  feature: string;
  operator: Operator;
  value: number | string | (number | string)[];
}

export interface Rule {
  id: string;
  name: string;
  typology: Typology;
  severity: RuleHit["severity"];
  conditions: RuleCondition[];
  score: number;
  explanationTemplate: string;
  enabled: boolean;
}

// Rules are DATA, not code buried in components. The UI can toggle `enabled`
// and edit thresholds, then the pipeline re-evaluates.
export const DEFAULT_RULES: Rule[] = [
  {
    id: "RULE-MCC-001",
    name: "Declared MCC conflicts with observed channel behavior",
    typology: "MCC_MISCODING",
    severity: "HIGH",
    conditions: [
      { feature: "cardNotPresentRatio", operator: ">", value: 0.9 },
      { feature: "declaredMcc", operator: "in", value: ["5411", "5812", "5814", "5499", "5541"] },
      { feature: "nightRatio", operator: ">", value: 0.4 },
    ],
    score: 30,
    explanationTemplate:
      "Declared as {{declaredMccLabel}} but {{cardNotPresentPct}}% of activity is card-not-present and {{nightPct}}% occurs overnight.",
    enabled: true,
  },
  {
    id: "RULE-MCC-002",
    name: "Behavior diverges sharply from declared category profile",
    typology: "MCC_MISCODING",
    severity: "HIGH",
    conditions: [{ feature: "mccDivergence", operator: ">", value: 0.45 }],
    score: 26,
    explanationTemplate:
      "Observed behavior diverges from the {{declaredMccLabel}} peer profile (divergence {{mccDivergence}}).",
    enabled: true,
  },
  {
    id: "RULE-MCC-003",
    name: "Gaming product signals under low-risk MCC",
    typology: "MCC_MISCODING",
    severity: "CRITICAL",
    conditions: [
      { feature: "cashEquivalentRatio", operator: ">", value: 0.2 },
      { feature: "declaredMcc", operator: "in", value: ["5411", "5812", "5499", "5999"] },
    ],
    score: 24,
    explanationTemplate:
      "{{cashEquivalentPct}}% of transactions carry cash-equivalent signals inconsistent with {{declaredMccLabel}}.",
    enabled: true,
  },
  {
    id: "RULE-SPLIT-001",
    name: "Repeated near-threshold ticket clustering",
    typology: "SPLIT_TICKETING",
    severity: "HIGH",
    conditions: [
      { feature: "thresholdProximityRatio", operator: ">", value: 0.25 },
      { feature: "rapidRepeatRatio", operator: ">", value: 0.08 },
    ],
    score: 28,
    explanationTemplate:
      "{{thresholdProximityPct}}% of purchases sit just below the ${{threshold}} threshold with {{rapidRepeatPct}}% rapid same-card repeats.",
    enabled: true,
  },
  {
    id: "RULE-FACT-001",
    name: "High descriptor diversity for a single merchant ID",
    typology: "FACTORING",
    severity: "HIGH",
    conditions: [
      { feature: "descriptorCount", operator: ">=", value: 4 },
      { feature: "descriptorEntropy", operator: ">", value: 1.2 },
    ],
    score: 26,
    explanationTemplate:
      "Merchant processes under {{descriptorCount}} descriptors (entropy {{descriptorEntropy}}) — atypical for a single business.",
    enabled: true,
  },
  {
    id: "RULE-FACT-002",
    name: "Shared settlement / infrastructure with other entities",
    typology: "FACTORING",
    severity: "CRITICAL",
    conditions: [{ feature: "sharedBankAccountCount", operator: ">=", value: 2 }],
    score: 24,
    explanationTemplate:
      "Settlement account shared with {{sharedBankAccountCount}} other merchants, including higher-risk entities.",
    enabled: true,
  },
  {
    id: "RULE-DESC-001",
    name: "Descriptor mimics a known brand",
    typology: "FAKE_DESCRIPTOR",
    severity: "HIGH",
    conditions: [
      { feature: "brandMimicScore", operator: ">", value: 0.5 },
      { feature: "descriptorNameSimilarity", operator: "<", value: 0.4 },
    ],
    score: 27,
    explanationTemplate:
      "Descriptor resembles a national brand (mimic {{brandMimicScore}}) while matching the legal name only {{descriptorNamePct}}%.",
    enabled: true,
  },
  {
    id: "RULE-DESC-002",
    name: "Elevated 'merchant not recognized' disputes",
    typology: "FAKE_DESCRIPTOR",
    severity: "MEDIUM",
    conditions: [{ feature: "notRecognizedDisputeRate", operator: ">", value: 0.02 }],
    score: 18,
    explanationTemplate:
      "{{notRecognizedPct}}% of transactions are disputed as 'merchant not recognized'.",
    enabled: true,
  },
  {
    id: "RULE-CASH-001",
    name: "Round-dollar purchases with immediate refunds",
    typology: "CASH_DISBURSEMENT",
    severity: "HIGH",
    conditions: [
      { feature: "roundDollarRatio", operator: ">", value: 0.45 },
      { feature: "refundAfterPurchaseRatio", operator: ">", value: 0.15 },
    ],
    score: 28,
    explanationTemplate:
      "{{roundDollarPct}}% round-dollar purchases with {{refundAfterPct}}% refund-after-purchase — a cash-extraction signature.",
    enabled: true,
  },
  {
    id: "RULE-CASH-002",
    name: "Wallet-load behavior under retail MCC",
    typology: "CASH_DISBURSEMENT",
    severity: "HIGH",
    conditions: [
      { feature: "walletLoadRatio", operator: ">", value: 0.2 },
      { feature: "declaredMcc", operator: "in", value: ["5411", "5812", "5499", "5999", "5541"] },
    ],
    score: 24,
    explanationTemplate:
      "{{walletLoadPct}}% of activity shows wallet-load indicators inconsistent with {{declaredMccLabel}}.",
    enabled: true,
  },
  {
    id: "RULE-GEN-001",
    name: "High cross-border card-not-present migration",
    typology: "MCC_MISCODING",
    severity: "MEDIUM",
    conditions: [
      { feature: "crossBorderRatio", operator: ">", value: 0.4 },
      { feature: "cardNotPresentRatio", operator: ">", value: 0.7 },
    ],
    score: 16,
    explanationTemplate:
      "{{crossBorderPct}}% cross-border with {{cardNotPresentPct}}% card-not-present suggests location masking.",
    enabled: true,
  },
];

type EvalContext = Record<string, number | string>;

export function buildEvalContext(m: MerchantProfile, f: MerchantFeatures): EvalContext {
  return {
    ...f,
    declaredMcc: m.declaredMcc,
  } as unknown as EvalContext;
}

function evalCondition(ctx: EvalContext, c: RuleCondition): boolean {
  const actual = ctx[c.feature];
  if (actual === undefined) return false;
  switch (c.operator) {
    case ">":
      return Number(actual) > Number(c.value);
    case ">=":
      return Number(actual) >= Number(c.value);
    case "<":
      return Number(actual) < Number(c.value);
    case "<=":
      return Number(actual) <= Number(c.value);
    case "==":
      return actual === c.value;
    case "in":
      return Array.isArray(c.value) && (c.value as (string | number)[]).includes(actual);
    case "not-in":
      return Array.isArray(c.value) && !(c.value as (string | number)[]).includes(actual);
    default:
      return false;
  }
}

function pct(x: number): string {
  return (x * 100).toFixed(0);
}

function renderTemplate(tpl: string, m: MerchantProfile, f: MerchantFeatures): string {
  const map: Record<string, string> = {
    declaredMccLabel: mccLabel(m.declaredMcc),
    cardNotPresentPct: pct(f.cardNotPresentRatio),
    nightPct: pct(f.nightRatio),
    cashEquivalentPct: pct(f.cashEquivalentRatio),
    walletLoadPct: pct(f.walletLoadRatio),
    roundDollarPct: pct(f.roundDollarRatio),
    refundAfterPct: pct(f.refundAfterPurchaseRatio),
    thresholdProximityPct: pct(f.thresholdProximityRatio),
    rapidRepeatPct: pct(f.rapidRepeatRatio),
    crossBorderPct: pct(f.crossBorderRatio),
    notRecognizedPct: pct(f.notRecognizedDisputeRate),
    descriptorNamePct: pct(f.descriptorNameSimilarity),
    descriptorCount: String(f.descriptorCount),
    descriptorEntropy: f.descriptorEntropy.toFixed(2),
    brandMimicScore: f.brandMimicScore.toFixed(2),
    mccDivergence: f.mccDivergence.toFixed(2),
    sharedBankAccountCount: String(f.sharedBankAccountCount),
    threshold: "500",
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? `{{${k}}}`);
}

export function evaluateRules(
  m: MerchantProfile,
  f: MerchantFeatures,
  rules: Rule[],
): RuleHit[] {
  const ctx = buildEvalContext(m, f);
  const hits: RuleHit[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.conditions.every((c) => evalCondition(ctx, c))) {
      hits.push({
        ruleId: rule.id,
        name: rule.name,
        typology: rule.typology,
        severity: rule.severity,
        score: rule.score,
        explanation: renderTemplate(rule.explanationTemplate, m, f),
      });
    }
  }
  return hits;
}
