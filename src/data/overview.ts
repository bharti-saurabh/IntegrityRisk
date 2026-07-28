// Typed accessor for the compact, self-contained Overview payload produced by
// pipeline/build_web_artifacts.py. The JSON is bundled into the static build (no
// fetch, no keys) so the public GitHub Pages demo renders the executive summary
// with zero configuration. Every figure here is a *model output*; only the
// `detection` block is measured against the synthetic ground-truth labels.
import raw from "./overview.generated.json";

export type FamilyKey =
  | "mcc_miscoding"
  | "mcc_abuse"
  | "split_ticketing"
  | "factoring"
  | "surcharge"
  | "cash";

export type OverviewTier = "Critical" | "High" | "Elevated" | "Monitor" | "Low";

export interface Portfolio {
  merchantsMonitored: number;
  transactionsScored: number;
  grossSalesUsd: number;
  flaggedMerchants: number;
  flaggedExposureUsd: number;
  flaggedExposurePct: number;
  criticalMerchants: number;
}

// Recall is intentionally excluded — it needs the true positive universe, which is
// unknowable for a live integrity book. Detection quality is reported as precision,
// alert volume (tp+fp) and captured exposure $.
export interface Detection {
  precision: number;
  tp: number;
  fp: number;
  fn: number;
  alertVolume: number;
  capturedExposureUsd: number;
  integrityViolations: number;
  interchangeAbuse: number;
}

export interface TierSlice {
  tier: OverviewTier;
  count: number;
  exposure: number;
}

export interface PriorityTier {
  tier: "P1" | "P2" | "P3";
  label: string;
  alerts: number;
}

export interface Subtype {
  key: string;
  label: string;
  tier: "P1" | "P2" | "P3" | "—";
  alerts: number;
  exposure: number;
}

export interface Family {
  key: FamilyKey;
  label: string;
  alerts: number;
  exposure: number;
  critical: number;
  high: number;
  tierCounts: Record<OverviewTier, number>;
  separateClass: boolean;
  priorityTiers?: PriorityTier[];
  subtypes?: Subtype[];
}

export interface PriorityMerchant {
  id: string;
  name: string;
  corp: string;
  city: string;
  country: string;
  declaredMcc: string;
  mccGroup: string;
  score: number;
  tier: OverviewTier;
  family: FamilyKey;
  familyLabel: string;
  subtype: string | null;
  exposure: number;
  rules: string[];
  flagReason: string;
}

export interface TrendPoint {
  date: string;
  volume: number;
  flaggedVolume: number;
}

export interface Overview {
  portfolio: Portfolio;
  detection: Detection | null;
  tiers: TierSlice[];
  families: Family[];
  priority: PriorityMerchant[];
  trend: TrendPoint[];
  meta: { source: string; note: string };
}

export const overview = raw as unknown as Overview;

export const TIER_ORDER: OverviewTier[] = ["Critical", "High", "Elevated", "Monitor", "Low"];

export const TIER_HEX: Record<OverviewTier, string> = {
  Critical: "#dc2626",
  High: "#e11d48",
  Elevated: "#d97706",
  Monitor: "#2563eb",
  Low: "#059669",
};

/** Family accent hues + route + icon. Hues are categorical identity, never severity. */
export const FAMILY_META: Record<FamilyKey, { color: string; icon: string; route: string; blurb: string }> = {
  mcc_miscoding: {
    color: "#2563eb",
    icon: "Layers",
    route: "/mcc",
    blurb: "Declared category code hides the merchant's true, higher-risk line of business.",
  },
  mcc_abuse: {
    color: "#7c3aed",
    icon: "Gauge",
    route: "/mcc-abuse",
    blurb: "Coded into a cheaper interchange band than the settlement behaviour warrants.",
  },
  split_ticketing: {
    color: "#d97706",
    icon: "Split",
    route: "/split",
    blurb: "One purchase fragmented into bursts to stay under authorization ceilings.",
  },
  factoring: {
    color: "#e11d48",
    icon: "Share2",
    route: "/factoring",
    blurb: "A registered outlet settling transactions on behalf of undisclosed sub-merchants.",
  },
  surcharge: {
    color: "#059669",
    icon: "BadgePercent",
    route: "/surcharge",
    blurb: "A card surcharge over the brand cap, on prohibited debit/prepaid, or without disclosure — surfacing as unexpected-fee disputes.",
  },
  cash: {
    color: "#6366f1",
    icon: "Banknote",
    route: "/cash",
    blurb: "Card acceptance used as a quasi-cash disbursement channel.",
  },
};

export const PRIORITY_TIER_HEX: Record<"P1" | "P2" | "P3", string> = {
  P1: "#dc2626",
  P2: "#d97706",
  P3: "#2563eb",
};
