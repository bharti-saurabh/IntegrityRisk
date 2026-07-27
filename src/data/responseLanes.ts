// ---------------------------------------------------------------------------
// Response lanes — the operating-model layer over the detection typologies.
//
// A typology answers "what is the abuse". A lane answers "who owns the response
// and what do they do about it". The mapping is deliberately many-to-one: several
// typologies can land on the same desk, which is why the executive view groups on
// the lane but still tags the underlying typologies on each merchant.
//
// Lane colors are a SEPARATE palette from TYPOLOGY_COLOR on purpose — lane color
// encodes ownership (a category), never severity. Severity is carried only by the
// risk tier. Synthetic demo taxonomy; not a real institution's org chart.
// ---------------------------------------------------------------------------

import type { MerchantRiskRecord, RiskTier, Typology } from "@/types/domain";

export type ResponseLaneId = "FINANCIAL_CRIME" | "CONTROLS" | "CONDUCT";

type AbuseTypology = Exclude<Typology, "CLEAN">;

export interface ResponseLaneDef {
  id: ResponseLaneId;
  label: string;
  /** Accountable desk for every merchant routed into this lane. */
  owner: string;
  /** The standing action this lane performs on its queue. */
  action: string;
  /** Why these typologies share a desk. */
  rationale: string;
  color: string;
  typologies: AbuseTypology[];
  /** Queue verb shown per merchant — escalated form for critical tier. */
  verb: { critical: string; standard: string };
}

export const RESPONSE_LANES: ResponseLaneDef[] = [
  {
    id: "FINANCIAL_CRIME",
    label: "Financial Crime & AML",
    owner: "BSA / Financial Crime desk",
    action: "Deboard & SAR review",
    rationale:
      "Both typologies move value for a third party the acquirer never underwrote, which is a money-laundering exposure rather than a coding error.",
    color: "#3538cd",
    typologies: ["FACTORING", "CASH_DISBURSEMENT"],
    verb: { critical: "Deboard", standard: "Investigate" },
  },
  {
    id: "CONTROLS",
    label: "Controls & Monitoring",
    owner: "Monitoring Operations",
    action: "Tighten thresholds",
    rationale:
      "Structuring around authorization limits and interchange-qualification downgrades are both control-calibration failures — the fix is a threshold / qualification change and pricing recovery, not an enforcement action.",
    color: "#0e7490",
    typologies: ["SPLIT_TICKETING", "MCC_ABUSE"],
    verb: { critical: "Restrict", standard: "Monitor" },
  },
  {
    id: "CONDUCT",
    label: "Conduct & Consumer",
    owner: "Conduct Compliance",
    action: "Descriptor & category remediation",
    rationale:
      "Miscoded categories and misleading descriptors both surface to the cardholder as a misrepresentation, driving disputes and prohibited-content exposure.",
    color: "#a21caf",
    typologies: ["MCC_MISCODING", "FAKE_DESCRIPTOR"],
    verb: { critical: "Suspend", standard: "Remediate" },
  },
];

export const LANE_DEF: Record<ResponseLaneId, ResponseLaneDef> = RESPONSE_LANES.reduce(
  (acc, l) => {
    acc[l.id] = l;
    return acc;
  },
  {} as Record<ResponseLaneId, ResponseLaneDef>,
);

export const LANE_BY_TYPOLOGY: Record<AbuseTypology, ResponseLaneId> = RESPONSE_LANES.reduce(
  (acc, lane) => {
    for (const t of lane.typologies) acc[t] = lane.id;
    return acc;
  },
  {} as Record<AbuseTypology, ResponseLaneId>,
);

/**
 * Every typology a merchant materially trips, strongest first.
 *
 * The primary typology is always included so a record is never tagless. A
 * SECONDARY typology is reported only when the merchant sits above the
 * portfolio's top-decile cut for that specific typology (see
 * `PortfolioAggregates.typologyActiveThresholds`). The cut has to be per-typology
 * and distribution-derived rather than one fixed number: the raw typology scores
 * sit on very different scales, so a single absolute threshold would tag a
 * typology with a high flat baseline onto essentially every merchant.
 */
export function activeTypologies(
  r: MerchantRiskRecord,
  thresholds: Record<AbuseTypology, number>,
): AbuseTypology[] {
  if (r.primaryTypology === "CLEAN") return [];
  const entries = Object.entries(r.typologyScores) as [AbuseTypology, number][];
  return entries
    .filter(([t, v]) => t === r.primaryTypology || v > thresholds[t])
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

/** The desk that owns this merchant's response, routed off the primary typology. */
export function laneForRecord(r: MerchantRiskRecord): ResponseLaneId | null {
  if (r.primaryTypology === "CLEAN") return null;
  return LANE_BY_TYPOLOGY[r.primaryTypology];
}

/** Lanes a merchant touches through any active typology, not just the primary. */
export function lanesTouched(
  r: MerchantRiskRecord,
  thresholds: Record<AbuseTypology, number>,
): ResponseLaneId[] {
  const seen = new Set<ResponseLaneId>();
  for (const t of activeTypologies(r, thresholds)) seen.add(LANE_BY_TYPOLOGY[t]);
  return RESPONSE_LANES.filter((l) => seen.has(l.id)).map((l) => l.id);
}

export function queueVerb(lane: ResponseLaneId, tier: RiskTier): string {
  const def = LANE_DEF[lane];
  return tier === "critical" ? def.verb.critical : def.verb.standard;
}
