import type {
  MerchantRiskRecord,
  InvestigationCase,
  CaseMerchant,
  RecommendedAction,
  Typology,
  CaseStatus,
  RiskTier,
} from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { DATA_ANCHOR_MS } from "@/data/generator";
import { exposureForRecord } from "@/analytics/aggregates";
import { Rng } from "@/utils/rng";

const ANALYSTS = ["A. Reyes", "K. Osei", "M. Tanaka", "L. Franklin", "S. Duarte", "J. Novak"];
const QUEUES = ["MCC Integrity", "Laundering & Factoring", "Surcharge Abuse", "Cash Abuse", "Escalations"];

// Human-readable acquirer names, keyed deterministically off the ACQ-### id so a
// case reads like a real sponsoring bank rather than an opaque code.
const ACQUIRER_NAMES = [
  "Meridian Merchant Bank",
  "Harbor Point Acquiring",
  "Cascade Payments Bank",
  "Ironwood Financial",
  "Summit Card Services",
  "Beacon Acquiring Group",
  "Keystone Merchant Bank",
  "Pinnacle Payment Partners",
  "Granite State Acquiring",
  "Silverline Financial",
  "Northwind Merchant Bank",
  "Cornerstone Acquiring",
];

export function acquirerNameFor(acquirerId: string): string {
  const n = parseInt(acquirerId.replace(/\D/g, ""), 10);
  if (Number.isNaN(n)) return acquirerId;
  return ACQUIRER_NAMES[n % ACQUIRER_NAMES.length];
}

function queueFor(t: Typology): string {
  switch (t) {
    case "MCC_MISCODING":
    case "MCC_ABUSE":
      return QUEUES[0];
    case "FACTORING":
      return QUEUES[1];
    case "CARD_SURCHARGE":
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
    if (t === "MCC_ABUSE") return "correct-mcc";
    if (t === "FACTORING") return "escalate-network-integrity";
    if (t === "CASH_DISBURSEMENT") return "suspend-txn-types";
    if (t === "CARD_SURCHARGE") return "restrict-processing";
    return "enhanced-due-diligence";
  }
  if (t === "MCC_ABUSE") return "request-info";
  if (t === "MCC_MISCODING") return "request-info";
  if (t === "FACTORING") return "review-facilitator";
  if (t === "CASH_DISBURSEMENT") return "heightened-monitoring";
  if (t === "CARD_SURCHARGE") return "merchant-outreach";
  return "continue-monitoring";
}

// Per-merchant fine = a network assessment scaled by exposure plus a flat
// brand-rule penalty by severity. Deterministic (exposure + tier are), with a
// small seeded jitter so identical exposures don't render identically.
function fineFor(exposure: number, tier: RiskTier, rng: Rng): number {
  const rate = tier === "critical" ? 0.12 : 0.06;
  const flat = tier === "critical" ? 25000 : 10000;
  const jitter = rng.float(0.9, 1.12);
  return Math.round((exposure * rate + flat) * jitter);
}

function dominantTypology(members: CaseMerchant[]): Typology {
  const counts = new Map<Typology, number>();
  for (const m of members) counts.set(m.typology, (counts.get(m.typology) ?? 0) + 1);
  let best: Typology = members[0].typology;
  let bestN = 0;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  return best;
}

function acquirerHypothesis(name: string, members: CaseMerchant[], dominant: Typology, totalFine: number): string {
  const typs = new Set(members.map((m) => m.typology));
  const typList = [...typs].map((t) => TYPOLOGY_LABELS[t]).join(", ");
  const crit = members.filter((m) => m.tier === "critical").length;
  const fineStr = `$${totalFine.toLocaleString("en-US")}`;
  return `${name} sponsors ${members.length} merchant${members.length === 1 ? "" : "s"} flagged for integrity violations (${typList})${
    crit ? `, ${crit} at critical severity` : ""
  }. Predominant pattern: ${TYPOLOGY_LABELS[dominant]}. Rolled-up proposed fine across the portfolio is ${fineStr}, assessed per merchant. Requires acquirer-level remediation and a portfolio review.`;
}

export function seedCases(records: MerchantRiskRecord[]): InvestigationCase[] {
  const flagged = records.filter(
    (r) => r.scores.tier === "high" || r.scores.tier === "critical",
  );

  // Group flagged merchants by sponsoring acquirer.
  const byAcquirer = new Map<string, MerchantRiskRecord[]>();
  for (const r of flagged) {
    const aid = r.merchant.acquirerId;
    const arr = byAcquirer.get(aid);
    if (arr) arr.push(r);
    else byAcquirer.set(aid, [r]);
  }

  const cases: InvestigationCase[] = [];
  // Deterministic order: acquirer id ascending.
  const acquirerIds = [...byAcquirer.keys()].sort();

  acquirerIds.forEach((aid) => {
    const recs = byAcquirer.get(aid)!
      .slice()
      .sort((a, b) => b.scores.finalRiskScore - a.scores.finalRiskScore);
    const rng = new Rng(`case-acq-${aid}`);
    const name = acquirerNameFor(aid);

    const members: CaseMerchant[] = recs.map((r) => {
      const exposure = exposureForRecord(r);
      return {
        merchantId: r.merchant.merchantId,
        tradeName: r.merchant.tradeName,
        typology: r.primaryTypology,
        tier: r.scores.tier,
        modelScore: r.scores.finalRiskScore,
        exposure,
        fineUsd: fineFor(exposure, r.scores.tier, rng),
      };
    });

    const totalFineUsd = members.reduce((a, m) => a + m.fineUsd, 0);
    const totalExposure = members.reduce((a, m) => a + m.exposure, 0);
    const hasCritical = members.some((m) => m.tier === "critical");
    const severity: RiskTier = hasCritical ? "critical" : "high";
    const dominant = dominantTypology(members);
    const rep = recs[0];

    const createdAt = DATA_ANCHOR_MS - rng.int(1, 28) * 86400000;
    const statusRoll = rng.next();
    let status: CaseStatus = "new";
    if (hasCritical) status = statusRoll < 0.5 ? "investigating" : statusRoll < 0.8 ? "escalated" : "triage";
    else status = statusRoll < 0.35 ? "new" : statusRoll < 0.7 ? "triage" : "investigating";
    const resolved = rng.next() < 0.18;
    if (resolved) status = rng.bool(0.5) ? "resolved" : "closed";

    // Rollups: confirmed-abuse members drive prevented exposure / recovery.
    const confirmedExposure = recs
      .filter((r) => r.merchant.groundTruthAbuseFlag)
      .reduce((a, r) => a + exposureForRecord(r), 0);

    cases.push({
      caseId: `CASE-${aid}`,
      alertId: `ALERT-${aid}`,
      acquirerId: aid,
      acquirerName: name,
      merchantId: rep.merchant.merchantId,
      members,
      merchantCount: members.length,
      totalFineUsd,
      createdAt,
      severity,
      queue: queueFor(dominant),
      assignedAnalyst: rng.pick(ANALYSTS),
      status,
      slaDueAt: createdAt + (hasCritical ? 2 : 5) * 86400000,
      typology: dominant,
      modelScore: rep.scores.finalRiskScore,
      disposition: resolved ? (confirmedExposure > 0 ? "confirmed-abuse" : "false-positive") : "pending",
      recommendedAction: recommendedActionFor(dominant, severity),
      hypothesis: acquirerHypothesis(name, members, dominant, totalFineUsd),
      notes: [
        {
          id: "n0",
          author: "System",
          timestamp: createdAt,
          text: `Auto-generated acquirer case for ${name} — ${members.length} flagged merchant${members.length === 1 ? "" : "s"}, ${TYPOLOGY_LABELS[dominant]} predominant. Portfolio at-risk exposure ${Math.round(totalExposure).toLocaleString("en-US")}.`,
        },
      ],
      audit: [{ id: "a0", timestamp: createdAt, actor: "System", action: `Acquirer case opened (${members.length} merchants)` }],
      recoveredAmount: resolved && confirmedExposure > 0 ? Math.round(confirmedExposure * rng.float(0.2, 0.6)) : 0,
      preventedExposure: resolved && confirmedExposure > 0 ? confirmedExposure : 0,
      resolutionDate: resolved ? createdAt + rng.int(1, 20) * 86400000 : null,
    });
  });

  return cases;
}
