import type { RecommendedAction, Disposition, CaseStatus, RiskTier, Typology } from "@/types/domain";

export const RECOMMENDED_ACTION_LABELS: Record<RecommendedAction, string> = {
  "no-action": "No action",
  "continue-monitoring": "Continue monitoring",
  "request-info": "Request additional merchant information",
  "enhanced-due-diligence": "Conduct enhanced due diligence",
  "correct-mcc": "Correct MCC",
  "restrict-processing": "Restrict processing behavior",
  "heightened-monitoring": "Place on heightened monitoring",
  "review-facilitator": "Review payment facilitator",
  "escalate-network-integrity": "Escalate to network integrity",
  "merchant-outreach": "Initiate merchant outreach",
  "suspend-txn-types": "Suspend specific transaction types",
  "terminate-relationship": "Terminate processing relationship",
  "legal-compliance-review": "Refer for legal / compliance review",
};

export const RECOMMENDED_ACTIONS: RecommendedAction[] = Object.keys(
  RECOMMENDED_ACTION_LABELS,
) as RecommendedAction[];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  pending: "Pending review",
  "false-positive": "False positive",
  "confirmed-abuse": "Confirmed abuse (candidate)",
  monitor: "Monitor",
  "insufficient-evidence": "Insufficient evidence",
};

export const DISPOSITIONS: Disposition[] = Object.keys(DISPOSITION_LABELS) as Disposition[];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "New",
  triage: "Triage",
  investigating: "Investigating",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export const CASE_STATUSES: CaseStatus[] = Object.keys(CASE_STATUS_LABELS) as CaseStatus[];

export const TIER_LABELS: Record<RiskTier, string> = {
  critical: "Critical",
  high: "High",
  elevated: "Elevated",
  watch: "Watch",
  clear: "Clear",
};

// Tailwind color helpers keyed by tier / typology for consistent styling.
export const TIER_COLOR: Record<RiskTier, string> = {
  critical: "text-critical",
  high: "text-high",
  elevated: "text-amber",
  watch: "text-cyan",
  clear: "text-ok",
};

export const TIER_BG: Record<RiskTier, string> = {
  critical: "bg-critical/15 text-critical border-critical/30",
  high: "bg-high/15 text-high border-high/30",
  elevated: "bg-amber/15 text-amber border-amber/30",
  watch: "bg-cyan/15 text-cyan border-cyan/30",
  clear: "bg-ok/15 text-ok border-ok/30",
};

export const TYPOLOGY_COLOR: Record<Exclude<Typology, "CLEAN">, string> = {
  MCC_MISCODING: "#2563eb",
  MCC_ABUSE: "#9333ea",
  SPLIT_TICKETING: "#d97706",
  FACTORING: "#7c3aed",
  CARD_SURCHARGE: "#e11d48",
  CASH_DISBURSEMENT: "#059669",
};
