import type {
  MerchantRiskRecord,
  InvestigationCase,
  RecommendedAction,
  Typology,
  CaseStatus,
} from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { DATA_ANCHOR_MS } from "@/data/generator";
import { exposureForRecord } from "@/analytics/aggregates";
import { Rng } from "@/utils/rng";

const ANALYSTS = ["A. Reyes", "K. Osei", "M. Tanaka", "L. Franklin", "S. Duarte", "J. Novak"];
const QUEUES = ["MCC Integrity", "Laundering & Factoring", "Descriptor Abuse", "Cash Abuse", "Escalations"];

function queueFor(t: Typology): string {
  switch (t) {
    case "MCC_MISCODING":
      return QUEUES[0];
    case "FACTORING":
      return QUEUES[1];
    case "FAKE_DESCRIPTOR":
      return QUEUES[2];
    case "CASH_DISBURSEMENT":
      return QUEUES[3];
    default:
      return QUEUES[4];
  }
}

export function recommendedActionFor(t: Typology, tier: string): RecommendedAction {
  if (tier === "critical") {
    if (t === "MCC_MISCODING") return "correct-mcc";
    if (t === "FACTORING") return "escalate-network-integrity";
    if (t === "CASH_DISBURSEMENT") return "suspend-txn-types";
    if (t === "FAKE_DESCRIPTOR") return "merchant-outreach";
    return "enhanced-due-diligence";
  }
  if (t === "MCC_MISCODING") return "request-info";
  if (t === "FACTORING") return "review-facilitator";
  if (t === "CASH_DISBURSEMENT") return "heightened-monitoring";
  if (t === "FAKE_DESCRIPTOR") return "merchant-outreach";
  return "continue-monitoring";
}

function hypothesisFor(r: MerchantRiskRecord): string {
  const t = r.primaryTypology;
  const m = r.merchant;
  if (t === "MCC_MISCODING")
    return `Declared as ${r.mcc.declaredLabel} but behavior matches ${r.mcc.predictedLabel} (${Math.round(r.mcc.confidence * 100)}% confidence). Likely miscoded to obtain lower-risk treatment.`;
  if (t === "SPLIT_TICKETING")
    return `${m.tradeName} appears to divide purchases into near-threshold clusters on shared cards/devices.`;
  if (t === "FACTORING")
    return `${m.tradeName} shows descriptor/category diversity and shared infrastructure consistent with processing for undisclosed third parties.`;
  if (t === "FAKE_DESCRIPTOR")
    return `Descriptor "${m.descriptor}" may mislead cardholders; elevated 'not recognized' disputes.`;
  if (t === "CASH_DISBURSEMENT")
    return `Round-dollar purchase/refund cycles suggest cash-equivalent extraction under a retail MCC.`;
  return `Elevated composite risk requires analyst review.`;
}

export function seedCases(records: MerchantRiskRecord[]): InvestigationCase[] {
  const flagged = records.filter(
    (r) => r.scores.tier === "high" || r.scores.tier === "critical",
  );
  const cases: InvestigationCase[] = [];
  flagged.forEach((r, i) => {
    const rng = new Rng(`case-${r.merchant.merchantId}`);
    const createdAt = DATA_ANCHOR_MS - rng.int(1, 28) * 86400000;
    const statusRoll = rng.next();
    let status: CaseStatus = "new";
    if (r.scores.tier === "critical") status = statusRoll < 0.5 ? "investigating" : statusRoll < 0.8 ? "escalated" : "triage";
    else status = statusRoll < 0.35 ? "new" : statusRoll < 0.7 ? "triage" : "investigating";
    const resolved = rng.next() < 0.18;
    if (resolved) status = rng.bool(0.5) ? "resolved" : "closed";
    const exposure = exposureForRecord(r);
    cases.push({
      caseId: `CASE-${String(1000 + i)}`,
      alertId: `ALERT-${r.merchant.merchantId}`,
      merchantId: r.merchant.merchantId,
      createdAt,
      severity: r.scores.tier,
      queue: queueFor(r.primaryTypology),
      assignedAnalyst: rng.pick(ANALYSTS),
      status,
      slaDueAt: createdAt + (r.scores.tier === "critical" ? 2 : 5) * 86400000,
      typology: r.primaryTypology,
      modelScore: r.scores.finalRiskScore,
      disposition: resolved ? (r.merchant.groundTruthAbuseFlag ? "confirmed-abuse" : "false-positive") : "pending",
      recommendedAction: recommendedActionFor(r.primaryTypology, r.scores.tier),
      hypothesis: hypothesisFor(r),
      notes: [
        {
          id: "n0",
          author: "System",
          timestamp: createdAt,
          text: `Auto-generated from ${TYPOLOGY_LABELS[r.primaryTypology]} alert. Composite risk ${r.scores.finalRiskScore}/100.`,
        },
      ],
      audit: [{ id: "a0", timestamp: createdAt, actor: "System", action: "Case created from alert" }],
      recoveredAmount: resolved && r.merchant.groundTruthAbuseFlag ? Math.round(exposure * rng.float(0.2, 0.6)) : 0,
      preventedExposure: resolved && r.merchant.groundTruthAbuseFlag ? exposure : 0,
      resolutionDate: resolved ? createdAt + rng.int(1, 20) * 86400000 : null,
    });
  });
  return cases;
}
