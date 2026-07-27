import type {
  MerchantRiskRecord,
  Transaction,
  Typology,
  FeatureContribution,
} from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { RECOMMENDED_ACTION_LABELS } from "@/features/cases/actions";
import { fmtPct } from "@/utils/format";

// The default AI mode is a DETERMINISTIC investigation-narrative generator. It
// synthesizes only from the structured evidence on the selected record — it
// never invents figures. Every claim cites the feature IDs it draws from.

export interface BriefSection {
  heading: string;
  body: string;
  citations: string[];
}

export interface InvestigationBrief {
  executiveSummary: string;
  primaryHypothesis: string;
  supporting: BriefSection[];
  mitigating: BriefSection[];
  likelyTypology: Typology;
  recommendedSteps: string[];
  suggestedDisposition: string;
  confidence: number;
  confidenceLabel: string;
  mode: "deterministic";
}

function topFeature(record: MerchantRiskRecord, id: string): FeatureContribution | undefined {
  return record.topFeatures.find((f) => f.id === id);
}

function citeList(record: MerchantRiskRecord, ids: string[]): string {
  return ids.filter((id) => topFeature(record, id)).map((id) => `[${id}]`).join(" ");
}

function confidenceFrom(record: MerchantRiskRecord): { value: number; label: string } {
  const thin = record.features.txnCount < 25;
  let base = Math.min(0.97, 0.35 + record.scores.finalRiskScore / 140 + record.mcc.confidence * 0.25);
  if (thin) base = Math.min(base, 0.45);
  const label = thin ? "Low (thin file — cold start)" : base > 0.75 ? "High" : base > 0.55 ? "Moderate" : "Low";
  return { value: Math.round(base * 100) / 100, label };
}

export function generateBrief(
  record: MerchantRiskRecord,
  transactions: Transaction[],
): InvestigationBrief {
  const m = record.merchant;
  const f = record.features;
  const s = record.scores;
  const typ = record.primaryTypology;
  const conf = confidenceFrom(record);

  const nightF = topFeature(record, "F-003");
  const cnpF = topFeature(record, "F-002");
  const divF = topFeature(record, "F-001");

  const summaryBits: string[] = [
    `${m.tradeName} (${m.merchantId}) carries a composite integrity-risk score of ${s.finalRiskScore}/100 (${s.tier.toUpperCase()}).`,
  ];
  if (record.mcc.mismatchSeverity !== "clear") {
    summaryBits.push(
      `Declared MCC ${record.mcc.declaredMcc} (${record.mcc.declaredLabel}) but observed behavior most resembles ${record.mcc.predictedMcc} (${record.mcc.predictedLabel}) at ${fmtPct(record.mcc.confidence)} model confidence.`,
    );
  }
  const executiveSummary = summaryBits.join(" ");

  const primaryHypothesis =
    typ === "CLEAN"
      ? `No abusive typology is well-supported. Elevated components appear explainable by legitimate operations; treat as a probable false positive pending review.`
      : `${TYPOLOGY_LABELS[typ]} is the leading hypothesis. ${record.ruleHits[0]?.explanation ?? "Composite anomaly signals drive the score."}`;

  // Supporting evidence — grounded, cited.
  const supporting: BriefSection[] = [];
  if (divF) {
    supporting.push({
      heading: "Declared category no longer fits observed behavior",
      body: `Behavioral divergence from the ${record.mcc.declaredLabel} peer profile is ${divF.display}${cnpF ? `, with a ${cnpF.display} card-not-present mix` : ""}${nightF ? ` and ${nightF.display} of activity overnight` : ""}.`,
      citations: ["F-001", "F-002", "F-003"].filter((id) => topFeature(record, id)),
    });
  }
  const cashF = topFeature(record, "F-004");
  const roundF = topFeature(record, "F-005");
  if (cashF || roundF) {
    supporting.push({
      heading: "Cash-equivalent extraction signals",
      body: `${cashF ? `${cashF.display} of transactions carry cash-equivalent markers` : ""}${cashF && roundF ? "; " : ""}${roundF ? `${roundF.display} are round-dollar amounts` : ""}. This pattern is atypical for the declared category.`,
      citations: ["F-004", "F-005", "F-006"].filter((id) => topFeature(record, id)),
    });
  }
  const threshF = topFeature(record, "F-007");
  if (threshF) {
    supporting.push({
      heading: "Threshold-avoidance / split-ticket signature",
      body: `${threshF.display} of purchases fall just below the monitoring threshold, consistent with deliberate ticket splitting.`,
      citations: ["F-007"],
    });
  }
  const brandF = topFeature(record, "F-010");
  const notRecF = topFeature(record, "F-011");
  if (brandF || notRecF) {
    supporting.push({
      heading: "Descriptor deception",
      body: `${brandF ? `Descriptor "${m.descriptor}" resembles a known brand (similarity ${brandF.display})` : ""}${brandF && notRecF ? "; " : ""}${notRecF ? `${notRecF.display} of disputes cite 'merchant not recognized'` : ""}.`,
      citations: ["F-010", "F-011", "F-018"].filter((id) => topFeature(record, id)),
    });
  }
  const bankF = topFeature(record, "F-013");
  const subF = topFeature(record, "F-014");
  if (bankF || subF) {
    supporting.push({
      heading: "Shared infrastructure / undisclosed entities",
      body: `${bankF ? `Settlement account is shared with ${bankF.display} other merchants` : ""}${bankF && subF ? "; " : ""}${subF ? `${subF.display} submerchant identities route through this entity` : ""}.${f.sharedIpCount > 0 ? ` ${f.sharedIpCount} shared IP links and ${f.sharedDeviceCount} shared devices were also observed.` : ""}`,
      citations: ["F-013", "F-014"].filter((id) => topFeature(record, id)),
    });
  }

  if (supporting.length === 0) {
    supporting.push({
      heading: "Composite anomaly",
      body: `The strongest single driver is ${record.topFeatures[0]?.label ?? "the composite score"} (${record.topFeatures[0]?.display ?? ""}). No individual typology dominates.`,
      citations: record.topFeatures.slice(0, 2).map((x) => x.id),
    });
  }

  // Mitigating / contradictory evidence — always present a counterargument.
  const mitigating: BriefSection[] = [];
  if (f.txnCount < 25) {
    mitigating.push({
      heading: "Thin transaction history",
      body: `Only ${f.txnCount} transactions are available; feature estimates are unstable and the score carries a wide confidence band.`,
      citations: [],
    });
  }
  if (f.disputeRate < 0.01) {
    mitigating.push({
      heading: "Low dispute rate",
      body: `Dispute rate is ${fmtPct(f.disputeRate)} — customers are largely not contesting these charges, which weakens a consumer-harm interpretation.`,
      citations: [],
    });
  }
  if (typ === "CLEAN" || m.declaredMcc === record.mcc.predictedMcc) {
    mitigating.push({
      heading: "Legitimate explanation available",
      body: `Elevated night-time or velocity signals are consistent with legitimate ${record.mcc.declaredLabel} operations (e.g. extended hours or seasonal demand). Peer-adjusted models do not confirm abuse.`,
      citations: [],
    });
  }
  if (f.descriptorNameSimilarity > 0.7) {
    mitigating.push({
      heading: "Descriptor matches legal name",
      body: `The descriptor closely matches the registered name (${fmtPct(f.descriptorNameSimilarity)}), reducing the likelihood of intentional descriptor deception.`,
      citations: ["F-018"],
    });
  }
  if (mitigating.length === 0) {
    mitigating.push({
      heading: "Limited contradictory evidence",
      body: `No strong mitigating signals were found in the available evidence. Analyst should still confirm via merchant outreach before any action.`,
      citations: [],
    });
  }

  // Recommended steps.
  const steps: string[] = [];
  if (record.mcc.mismatchSeverity === "critical" || record.mcc.mismatchSeverity === "high") {
    steps.push(`Request supporting documentation to confirm the declared ${record.mcc.declaredLabel} classification.`);
    steps.push(`If unsubstantiated, recommend MCC correction to ${record.mcc.predictedLabel} (${record.mcc.predictedMcc}).`);
  }
  if (typ === "FACTORING") steps.push("Review the payment facilitator's onboarding and the shared settlement account for undisclosed submerchants.");
  if (typ === "SPLIT_TICKETING") steps.push("Reconstruct the near-threshold clusters and confirm they represent single underlying purchases.");
  if (typ === "MCC_ABUSE") steps.push("Sample keyed/fallback and cross-border settlements and re-derive the qualified interchange tier; quantify the downgrade vs. the declared band.");
  if (typ === "CASH_DISBURSEMENT") steps.push("Sample round-dollar purchase/refund pairs and verify goods/services were actually delivered.");
  if (typ === "FAKE_DESCRIPTOR") steps.push("Initiate merchant outreach on descriptor accuracy and monitor 'not recognized' disputes.");
  steps.push(`Recommended action on file: ${RECOMMENDED_ACTION_LABELS[record.merchant.groundTruthAbuseFlag ? "enhanced-due-diligence" : "continue-monitoring"] ?? "continue monitoring"}.`);
  if (typ === "CLEAN") {
    steps.length = 0;
    steps.push("Document the false-positive rationale and clear the alert with peer-comparison evidence.");
    steps.push("Consider tuning the triggering rule threshold to reduce similar false positives.");
  }

  const suggestedDisposition =
    typ === "CLEAN"
      ? "Likely false positive — clear with documented rationale."
      : s.tier === "critical"
        ? "Confirmed-abuse candidate — escalate with the evidence above (decision support only; a named human must sign off)."
        : "Insufficient to confirm — proceed to enhanced due diligence.";

  void transactions;

  return {
    executiveSummary,
    primaryHypothesis,
    supporting,
    mitigating,
    likelyTypology: typ,
    recommendedSteps: steps,
    suggestedDisposition,
    confidence: conf.value,
    confidenceLabel: conf.label,
    mode: "deterministic",
  };
}

// --- Suggested-prompt answers (grounded, cited) ---------------------------

export interface CopilotPrompt {
  id: string;
  label: string;
}

export const COPILOT_PROMPTS: CopilotPrompt[] = [
  { id: "why", label: "Summarize why this merchant is suspicious" },
  { id: "mcc", label: "Compare declared MCC with observed behavior" },
  { id: "strongest", label: "Identify the strongest evidence" },
  { id: "weakest", label: "Show evidence that weakens the alert" },
  { id: "legit", label: "Identify plausible legitimate explanations" },
  { id: "next", label: "What additional evidence should an analyst request?" },
  { id: "outreach", label: "Draft a merchant outreach questionnaire" },
  { id: "escalation", label: "Draft an escalation summary" },
  { id: "action", label: "Recommend the next action" },
];

export function answerPrompt(
  promptId: string,
  record: MerchantRiskRecord,
  transactions: Transaction[],
): string {
  const brief = generateBrief(record, transactions);
  const m = record.merchant;
  const f = record.features;
  switch (promptId) {
    case "why":
      return `${brief.executiveSummary}\n\n${brief.primaryHypothesis} ${citeList(record, ["F-001", "F-002", "F-003", "F-004"])}`;
    case "mcc":
      return `Declared: ${record.mcc.declaredMcc} — ${record.mcc.declaredLabel}. Predicted: ${record.mcc.predictedMcc} — ${record.mcc.predictedLabel} at ${fmtPct(record.mcc.confidence)} confidence (mismatch: ${record.mcc.mismatchSeverity}). The declared category expects a very different channel/timing/ticket profile; observed divergence is ${topFeature(record, "F-001")?.display ?? "elevated"}. ${citeList(record, ["F-001", "F-002", "F-003"])}`;
    case "strongest":
      return `Strongest drivers:\n${record.topFeatures.slice(0, 4).map((x) => `• ${x.label}: ${x.display}  [${x.id}]`).join("\n")}`;
    case "weakest":
      return brief.mitigating.map((s) => `• ${s.heading}: ${s.body}`).join("\n");
    case "legit":
      return `Plausible legitimate explanations to rule out first:\n• Extended-hours or 24/7 operation explaining night ratio (${fmtPct(f.nightRatio)}).\n• Seasonal or promotional volume spikes.\n• A genuine digital/e-commerce model explaining the ${fmtPct(f.cardNotPresentRatio)} card-not-present mix.\nAnalyst should confirm via documentation before acting.`;
    case "next":
      return `Recommended evidence to request:\n${brief.recommendedSteps.map((s) => `• ${s}`).join("\n")}`;
    case "outreach":
      return `Merchant outreach questionnaire for ${m.tradeName}:\n1. Describe your primary line of business and confirm your MCC (${record.mcc.declaredMcc}).\n2. What products/services generated your last 10 transactions?\n3. Why is ${fmtPct(f.cardNotPresentRatio)} of your volume card-not-present?\n4. Explain the ${fmtPct(f.nightRatio)} of activity occurring overnight.\n5. List all descriptors you use and confirm settlement account ownership.\n6. Provide documentation supporting your declared category.`;
    case "escalation":
      return `ESCALATION — ${m.tradeName} (${m.merchantId})\nComposite risk: ${record.scores.finalRiskScore}/100 (${record.scores.tier}).\nLeading typology: ${TYPOLOGY_LABELS[record.primaryTypology]}.\nKey evidence: ${record.topFeatures.slice(0, 3).map((x) => `${x.label} ${x.display} [${x.id}]`).join("; ")}.\nDisposition: ${brief.suggestedDisposition}\nNote: decision support only — final determination requires a named reviewer.`;
    case "action":
      return `${brief.suggestedDisposition}\nProposed next steps:\n${brief.recommendedSteps.map((s) => `• ${s}`).join("\n")}`;
    default:
      return brief.executiveSummary;
  }
}
