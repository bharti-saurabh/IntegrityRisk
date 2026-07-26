import type { ExplorerMerchant } from "@/features/explorer/types";

// ---------------------------------------------------------------------------
// MCC-miscoding identification catalog.
//
// Architecture: we run SEVERAL detection models — one per prohibited/restricted
// business type. Each model surfaces the merchants that BEHAVE like that type
// but are declared (miscoded) under a benign MCC. The page is organized around
// these categories (not around individual merchants) so a remediation team can
// pull exactly their queue — e.g. "merchants likely ADULT but coded as retail".
//
// `key` matches ExplorerMerchant.top_category in public/data/merchants.json.
// ---------------------------------------------------------------------------

export type Priority = "P1" | "P2" | "P3";

export interface CategorySignal {
  key: keyof ExplorerMerchant;
  label: string;
  kind: "pct" | "bps" | "usd" | "count";
  /** Raw value at/above which the signal reads as elevated for this category. */
  elevated: number;
}

export interface MiscodingCategory {
  key: string; // top_category
  subtype: string; // ExplorerMerchant.subtype label
  short: string;
  priority: Priority;
  owner: string; // remediation team that pulls this queue
  behavesLike: string; // what these merchants actually operate as
  signals: CategorySignal[]; // significant variables the model weights
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "Prohibited / high-harm",
  P2: "Restricted",
  P3: "Elevated",
};

export const PRIORITY_HEX: Record<Priority, string> = {
  P1: "#dc2626",
  P2: "#d97706",
  P3: "#2563eb",
};

// Discriminative signals, shared across all typology families. Each is a raw
// ExplorerMerchant feature where a HIGHER value reads as more suspicious (so the
// σ-deviation viz stays meaningful). Exported for the other typology catalogs.
export const CNP: CategorySignal = { key: "pct_cnp", label: "Card-not-present", kind: "pct", elevated: 0.85 };
export const QUASI: CategorySignal = { key: "pct_quasi_cash", label: "Quasi-cash", kind: "pct", elevated: 0.1 };
export const ROUND: CategorySignal = { key: "pct_round_100", label: "Round-$100", kind: "pct", elevated: 0.15 };
export const RECUR: CategorySignal = { key: "pct_recurring", label: "Recurring billing", kind: "pct", elevated: 0.25 };
export const XBORDER: CategorySignal = { key: "pct_cross_border", label: "Cross-border", kind: "pct", elevated: 0.3 };
export const CB: CategorySignal = { key: "chargeback_rate_bps", label: "Chargeback rate", kind: "bps", elevated: 50 };
export const REFUND: CategorySignal = { key: "refund_rate_amount", label: "Refund rate", kind: "pct", elevated: 0.08 };
export const TICKET: CategorySignal = { key: "avg_ticket_usd", label: "Avg ticket", kind: "usd", elevated: 200 };
export const DESC: CategorySignal = { key: "n_distinct_descriptors", label: "Distinct descriptors", kind: "count", elevated: 3 };
export const SUBMERCH: CategorySignal = { key: "pct_txn_with_sub_merchant", label: "Sub-merchant txns", kind: "pct", elevated: 0.2 };

export const MISCODING_CATEGORIES: MiscodingCategory[] = [
  // ---- P1 · prohibited / high-harm ----
  { key: "gambling", subtype: "Gambling", short: "Gambling", priority: "P1", owner: "Gambling licensing review",
    behavesLike: "an online betting / casino operator", signals: [QUASI, ROUND, TICKET, CNP] },
  { key: "pharma", subtype: "Pharma", short: "Pharma", priority: "P1", owner: "Pharma / Rx compliance",
    behavesLike: "an unlicensed online pharmacy", signals: [RECUR, REFUND, XBORDER, CB] },
  { key: "adult", subtype: "Adult content", short: "Adult", priority: "P1", owner: "Adult-content attestation",
    behavesLike: "an adult-content operator", signals: [CNP, CB, RECUR] },
  { key: "dating_escort", subtype: "Dating & escort", short: "Dating/escort", priority: "P1", owner: "Adult / dating attestation",
    behavesLike: "a dating & escort service", signals: [CNP, CB, REFUND] },

  // ---- P2 · restricted ----
  { key: "crypto_cash", subtype: "Crypto / quasi-cash", short: "Crypto", priority: "P2", owner: "Crypto / MSB review",
    behavesLike: "a crypto / quasi-cash desk", signals: [QUASI, TICKET, CNP, ROUND] },
  { key: "game_of_skill", subtype: "Game of skill", short: "Skill gaming", priority: "P2", owner: "Gaming compliance",
    behavesLike: "a paid game-of-skill / contest operator", signals: [CNP, QUASI, ROUND] },
  { key: "cyberlocker", subtype: "Cyberlockers", short: "Cyberlocker", priority: "P2", owner: "Content / IP-abuse review",
    behavesLike: "a cyberlocker / file-host subscription", signals: [CNP, DESC, CB] },

  // ---- P3 · elevated ----
  { key: "nutra_subscription", subtype: "Nutra subscriptions", short: "Nutra", priority: "P3", owner: "Subscription / nutra remediation",
    behavesLike: "a nutraceutical free-trial subscription", signals: [RECUR, REFUND, CB, XBORDER] },
  { key: "financial_trading", subtype: "Financial trading", short: "Fin-trading", priority: "P3", owner: "Financial-services review",
    behavesLike: "a retail trading / brokerage platform", signals: [QUASI, TICKET, XBORDER] },
  { key: "telemarketing", subtype: "Telemarketing", short: "Telemarketing", priority: "P3", owner: "Telemarketing / UDAAP review",
    behavesLike: "an outbound telemarketing operation", signals: [CNP, CB, DESC] },
  { key: "tobacco_vape", subtype: "Tobacco & vape", short: "Tobacco/vape", priority: "P3", owner: "Age-restricted goods review",
    behavesLike: "a tobacco / vape retailer", signals: [CNP, TICKET, XBORDER] },
];

export const CATEGORY_BY_KEY: Record<string, MiscodingCategory> = Object.fromEntries(
  MISCODING_CATEGORIES.map((c) => [c.key, c]),
);

export const PRIORITY_ORDER: Priority[] = ["P1", "P2", "P3"];

export function categoriesByPriority(p: Priority): MiscodingCategory[] {
  return MISCODING_CATEGORIES.filter((c) => c.priority === p);
}

export function formatSignal(sig: CategorySignal, value: number): string {
  switch (sig.kind) {
    case "pct": return `${Math.round(value * 100)}%`;
    case "bps": return `${Math.round(value)} bps`;
    case "usd": return `$${Math.round(value)}`;
    case "count": return `${Math.round(value)}`;
  }
}

export function isElevated(sig: CategorySignal, value: number): boolean {
  return value >= sig.elevated;
}
