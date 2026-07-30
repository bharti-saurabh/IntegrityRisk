import type { ExplorerMerchant } from "@/features/explorer/types";

// ---------------------------------------------------------------------------
// Card-surcharge compliance engine (deterministic, synthetic, keyless).
//
// The analyst model for surcharge abuse is rule-based, not peer-deviation:
// legality turns on (1) the merchant's JURISDICTION regime — outright ban vs a
// statutory cap vs cost-of-acceptance — (2) the CARD PRODUCT TYPE surcharged
// (debit & prepaid are near-universally prohibited), (3) the actual surcharge %
// against that cap, and (4) point-of-sale DISCLOSURE.
//
// Plane B (merchants.json) carries merchant_country, surcharge_rate_bps and
// pct_txn_surcharged, but NOT product-type mix, jurisdiction rules or disclosure.
// Those are derived here — deterministically from the merchant id + declared
// category so the same merchant always assesses identically — and labelled as
// directional synthetic evidence, never as ground truth. No wall-clock, no RNG.
// ---------------------------------------------------------------------------

export type Regime = "ban" | "capped" | "cost-of-acceptance";
export type CellStatus = "pass" | "fail" | "info";
export type ComplianceStatus =
  | "COMPLIANT"
  | "POTENTIAL VIOLATION"
  | "SEVERE VIOLATION"
  | "INSUFFICIENT DATA";

export interface Jurisdiction {
  country: string;
  region: string;
  regime: Regime;
  /** Statutory cap as a percent; null for a ban or pure cost-of-acceptance. */
  capPct: number | null;
  /** Human-readable regime label for the "allowed" column. */
  allowLabel: string;
  /** Statutory basis / citation shown as evidence. */
  basis: string;
}

export interface ProductMix {
  credit: number;
  debit: number;
  prepaid: number;
}

export interface MatrixRow {
  param: string;
  detected: string;
  allowed: string;
  status: CellStatus;
  icon: string;
}

export interface SurchargeAssessment {
  jurisdiction: Jurisdiction;
  surchargePct: number;
  pctTxnSurcharged: number;
  productMix: ProductMix;
  /** Debit + prepaid share of card volume — the "prohibited product" exposure. */
  prohibitedShare: number;
  disclosed: boolean;
  overCap: boolean;
  status: ComplianceStatus;
  statusHex: string;
  primaryViolation: string;
  matrix: MatrixRow[];
  actions: string[];
  transactionNote: string;
  webNote: string;
}

// --- deterministic hash → [0,1) --------------------------------------------
function hash(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
const frac = (m: ExplorerMerchant, salt: string) => hash(m.merchant_id + salt);

// --- jurisdiction regime by country ----------------------------------------
// EU / EEA consumer-card surcharge ban (PSD2 Art. 62(4)); UK retained the ban
// under the Payment Services Regs 2017. Elsewhere a cap or cost-of-acceptance.
const EU_BAN = new Set([
  "DE", "FR", "IT", "ES", "NL", "IE", "CY", "MT", "AT", "BE", "PT",
  "FI", "LU", "EE", "LV", "LT", "SK", "SI", "GR", "PL", "SE", "DK",
]);

const REGION: Record<string, string> = {
  US: "United States", CA: "Canada", AU: "Australia", IN: "India",
  GB: "United Kingdom", AE: "United Arab Emirates", PA: "Panama",
  CW: "Curaçao", PH: "Philippines",
};

export function jurisdictionFor(country: string): Jurisdiction {
  const region = REGION[country] ?? (EU_BAN.has(country) ? "European Union" : country);
  if (EU_BAN.has(country)) {
    return {
      country, region, regime: "ban", capPct: null,
      allowLabel: "Surcharging banned",
      basis: "EU PSD2 Art. 62(4) — consumer-card surcharge prohibited",
    };
  }
  switch (country) {
    case "GB":
      return { country, region, regime: "ban", capPct: null,
        allowLabel: "Surcharging banned",
        basis: "UK Payment Services Regs 2017, reg. 6A — consumer-card surcharge ban" };
    case "US":
      return { country, region, regime: "capped", capPct: 3.0,
        allowLabel: "≤ 3.0% (cost of acceptance)",
        basis: "Visa/Mastercard cost-of-acceptance cap ≤3%; outright ban in CT, MA & PR" };
    case "CA":
      return { country, region, regime: "capped", capPct: 2.4,
        allowLabel: "≤ 2.4%",
        basis: "2022 Visa/Mastercard settlement — surcharge cap 2.4%" };
    case "AU":
      return { country, region, regime: "cost-of-acceptance", capPct: 1.5,
        allowLabel: "Cost of acceptance (~1.5%)",
        basis: "RBA surcharging standard — cost of acceptance only" };
    case "IN":
      return { country, region, regime: "capped", capPct: 1.0,
        allowLabel: "Debit banned; credit MDR-bound",
        basis: "RBI — no debit-card surcharging; credit bound by MDR" };
    default:
      return { country, region, regime: "cost-of-acceptance", capPct: null,
        allowLabel: "Cost of acceptance (brand rules)",
        basis: "No harmonised statutory cap — brand cost-of-acceptance rules apply" };
  }
}

const STATUS_HEX: Record<ComplianceStatus, string> = {
  COMPLIANT: "#16a34a",
  "POTENTIAL VIOLATION": "#f59e0b",
  "SEVERE VIOLATION": "#dc2626",
  "INSUFFICIENT DATA": "#64748b",
};

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const pct0 = (v: number) => `${Math.round(v)}%`;

export function assessSurcharge(m: ExplorerMerchant): SurchargeAssessment {
  const jur = jurisdictionFor(m.merchant_country);
  const surchargePct = m.surcharge_rate_bps / 100; // bps → %
  const pctTxnSurcharged = m.pct_txn_surcharged;
  const cat = m.top_category;

  // Product-type mix. Prohibited (debit/prepaid) merchants surcharge a heavy
  // debit/prepaid book by construction; the rest lean credit.
  const heavyProhibited = cat === "surcharge_prohibited";
  const debit = heavyProhibited ? 0.42 + frac(m, "d") * 0.2 : 0.18 + frac(m, "d") * 0.16;
  const prepaid = heavyProhibited ? 0.09 + frac(m, "p") * 0.08 : 0.02 + frac(m, "p") * 0.05;
  const credit = Math.max(0, 1 - debit - prepaid);
  const productMix: ProductMix = { credit, debit, prepaid };
  const prohibitedShare = debit + prepaid;

  const disclosed = cat !== "surcharge_undisclosed";
  const overCap = jur.capPct != null && surchargePct > jur.capPct;
  // A prohibited-product violation is levying the surcharge ON debit/prepaid —
  // not merely having them in the card mix. That is precisely what the
  // surcharge_prohibited model flags; other cohorts exempt debit/prepaid.
  const surchargesProhibited = cat === "surcharge_prohibited";
  const prohibitedProduct = surchargesProhibited;

  // Compliance status — most severe failing condition wins.
  let status: ComplianceStatus;
  if (jur.regime === "ban" || prohibitedProduct) status = "SEVERE VIOLATION";
  else if (overCap || !disclosed) status = "POTENTIAL VIOLATION";
  else status = "COMPLIANT";

  // Primary violation category (analyst taxonomy), same severity order.
  let primaryViolation: string;
  if (jur.regime === "ban")
    primaryViolation = `Regional ban — surcharging prohibited in ${jur.region}`;
  else if (prohibitedProduct)
    primaryViolation = "Prohibited product-type surcharge (debit / prepaid)";
  else if (overCap)
    primaryViolation = `Exceeded maximum fee cap (${pct1(surchargePct)} vs ${pct1(jur.capPct!)})`;
  else if (!disclosed)
    primaryViolation = "Failure to disclose at point of sale";
  else primaryViolation = "Within tolerance";

  const matrix: MatrixRow[] = [
    {
      param: "Merchant jurisdiction",
      detected: `${m.merchant_city}, ${m.merchant_country}`,
      allowed: jur.allowLabel,
      status: jur.regime === "ban" ? "fail" : "info",
      icon: "Globe",
    },
    {
      param: "Card product type",
      detected: `credit ${pct0(credit * 100)} · debit ${pct0(debit * 100)} · prepaid ${pct0(prepaid * 100)}`
        + (surchargesProhibited ? " — all surcharged" : " — debit/prepaid exempt"),
      allowed: "Debit & prepaid: no surcharge",
      status: prohibitedProduct ? "fail" : "pass",
      icon: "CreditCard",
    },
    {
      param: "Surcharge rate",
      detected: `${pct1(surchargePct)} on ${pct0(pctTxnSurcharged * 100)} of card txns`,
      allowed: jur.regime === "ban" ? "0% (banned)" : jur.capPct != null ? `≤ ${pct1(jur.capPct)}` : "Cost of acceptance",
      status: jur.regime === "ban" || overCap ? "fail" : "pass",
      icon: "BadgePercent",
    },
    {
      param: "POS disclosure",
      detected: disclosed ? "Disclosed at checkout" : "Not disclosed pre-auth",
      allowed: "Required",
      status: disclosed ? "pass" : "fail",
      icon: "FileText",
    },
  ];

  // Deterministic action plan keyed to the primary violation.
  const actions: string[] = [];
  if (jur.regime === "ban") {
    actions.push(`Issue cease-surcharge notice citing ${jur.basis}.`);
    actions.push("Commission a third-party audit transaction to capture the cleared surcharge line.");
    actions.push("Prepare brand-rules violation referral / fine assessment.");
  } else if (prohibitedProduct) {
    actions.push("Freeze debit & prepaid surcharging; notify the acquirer of the prohibited-product breach.");
    actions.push("Commission a mystery-shop test-buy on a debit card to confirm the cleared surcharge.");
    actions.push("Issue a warning letter with a 30-day cure period.");
  } else if (overCap) {
    actions.push(`Send a fee-cap breach notice (${pct1(surchargePct)} vs ${pct1(jur.capPct!)}).`);
    actions.push("Request cost-of-acceptance evidence to justify the rate.");
    actions.push("Monitor for unexpected-fee chargebacks and reversals.");
  } else if (!disclosed) {
    actions.push("Require a compliant point-of-sale surcharge disclosure before the next settlement.");
    actions.push("Mystery-shop the checkout to confirm the disclosure gap.");
    actions.push("Issue a warning letter; re-audit in 60 days.");
  } else {
    actions.push("No action — surcharge is within the local statutory tolerance.");
    actions.push("Retain in monitoring for rate or disclosure drift.");
  }

  const transactionNote =
    `Cleared authorisations carry a ${pct1(surchargePct)} surcharge on ${pct0(pctTxnSurcharged * 100)} of card volume. ` +
    (surchargesProhibited
      ? `~${pct0(prohibitedShare * 100)} of that volume is debit/prepaid and is being surcharged — prohibited product types. `
      : `Debit/prepaid (~${pct0(prohibitedShare * 100)} of the card mix) are exempted from the surcharge. `) +
    `Chargeback rate ${Math.round(m.chargeback_rate_bps)} bps — consistent with unexpected-fee disputes and reversals.`;

  const webNote = disclosed
    ? `Checkout displays a card-fee line stating ~${pct1(surchargePct)}. Simulated OSINT — recommend a test-buy to confirm the cleared amount matches the disclosure.`
    : `Checkout surfaces no card-fee line pre-authorisation; the surcharge appears only on the cleared statement. Simulated OSINT — recommend a test-buy to capture the true cleared amount.`;

  return {
    jurisdiction: jur,
    surchargePct,
    pctTxnSurcharged,
    productMix,
    prohibitedShare,
    disclosed,
    overCap,
    status,
    statusHex: STATUS_HEX[status],
    primaryViolation,
    matrix,
    actions,
    transactionNote,
    webNote,
  };
}

// ---------------------------------------------------------------------------
// Portfolio scan — the whole-book NCA recovery lens.
//
// The per-merchant console assesses one merchant; the demo also needs the
// acquirer-level story: run every surcharging merchant through the same regime
// engine and roll the failures up into the recovery opportunity. The book
// carries no acquirer field, so acquirers are assigned deterministically (same
// merchant → same acquirer) and labelled as synthetic in the UI. Jurisdiction,
// surcharge rate and surcharged volume are the real synthetic columns.
// ---------------------------------------------------------------------------

export const ACQUIRERS = [
  "Northgate Payments",
  "Vantage Acquiring Bank",
  "Meridian Acquiring",
  "Sterling Card Systems",
  "Atlas Merchant Services",
] as const;

/** Deterministic acquirer assignment — same merchant always maps identically. */
export function acquirerFor(m: ExplorerMerchant): string {
  return ACQUIRERS[Math.floor(hash(m.merchant_id + "acq") * ACQUIRERS.length)];
}

export type ViolationType =
  | "Regional ban"
  | "Prohibited debit/prepaid"
  | "Over-cap"
  | "Undisclosed";
export type Severity = "SEVERE" | "POTENTIAL";

const VIOLATION_HEX: Record<ViolationType, string> = {
  "Regional ban": "#dc2626",
  "Prohibited debit/prepaid": "#9333ea",
  "Over-cap": "#d97706",
  Undisclosed: "#0891b2",
};
export const violationHex = (vt: ViolationType) => VIOLATION_HEX[vt];

/** Classify a failing assessment into the portfolio taxonomy (or null if clean). */
function violationType(a: SurchargeAssessment): ViolationType | null {
  if (a.status === "COMPLIANT" || a.status === "INSUFFICIENT DATA") return null;
  if (a.jurisdiction.regime === "ban") return "Regional ban";
  if (a.status === "SEVERE VIOLATION") return "Prohibited debit/prepaid";
  if (a.overCap) return "Over-cap";
  if (!a.disclosed) return "Undisclosed";
  return null;
}

export interface PortfolioMerchant {
  id: string;
  name: string;
  city: string;
  country: string;
  region: string;
  vt: ViolationType;
  severity: Severity;
  surchargePct: number;
  pctSurcharged: number;
  /** Surcharged card volume under a failing regime = gross_sales · pct_surcharged. */
  pv: number;
  acquirer: string;
  tier: ExplorerMerchant["risk_tier"];
}

export interface SurchargePortfolio {
  kpi: {
    surcharging: number;
    violating: number;
    severe: number;
    potential: number;
    pv: number;
    ncaLow: number;
    ncaHigh: number;
  };
  byAcquirer: { acquirer: string; n: number; severe: number; pv: number }[];
  byViolation: { vt: ViolationType; n: number; pv: number; severity: Severity }[];
  byJurisdiction: { region: string; n: number; pv: number }[];
  merchants: PortfolioMerchant[]; // violating only, sorted by pv desc
}

const SEVERITY_OF: Record<ViolationType, Severity> = {
  "Regional ban": "SEVERE",
  "Prohibited debit/prepaid": "SEVERE",
  "Over-cap": "POTENTIAL",
  Undisclosed: "POTENTIAL",
};

/**
 * Run the compliance engine over the whole book and roll failures up to the
 * acquirer / violation-type / jurisdiction lenses plus the NCA recovery band.
 * `ncaLow`/`ncaHigh` are the per-violating-merchant assessment range (editable
 * in the console — a demo assumption, not a hardcoded claim).
 */
export function buildSurchargePortfolio(
  all: ExplorerMerchant[],
  ncaLow = 5000,
  ncaHigh = 10000,
): SurchargePortfolio {
  const surcharging = all.filter(
    (m) => m.surcharge_rate_bps > 0 && m.pct_txn_surcharged > 0,
  );

  const merchants: PortfolioMerchant[] = [];
  for (const m of surcharging) {
    const a = assessSurcharge(m);
    const vt = violationType(a);
    if (!vt) continue;
    merchants.push({
      id: m.merchant_id,
      name: m.merchant_name,
      city: m.merchant_city,
      country: m.merchant_country,
      region: a.jurisdiction.region,
      vt,
      severity: SEVERITY_OF[vt],
      surchargePct: a.surchargePct,
      pctSurcharged: m.pct_txn_surcharged,
      pv: Math.round(m.gross_sales_usd * m.pct_txn_surcharged),
      acquirer: acquirerFor(m),
      tier: m.risk_tier,
    });
  }
  merchants.sort((x, y) => y.pv - x.pv);

  const violating = merchants.length;
  const severe = merchants.filter((m) => m.severity === "SEVERE").length;
  const pv = merchants.reduce((s, m) => s + m.pv, 0);

  const acqMap = new Map<string, { n: number; severe: number; pv: number }>();
  for (const m of merchants) {
    const e = acqMap.get(m.acquirer) ?? { n: 0, severe: 0, pv: 0 };
    e.n += 1;
    if (m.severity === "SEVERE") e.severe += 1;
    e.pv += m.pv;
    acqMap.set(m.acquirer, e);
  }
  const byAcquirer = [...acqMap.entries()]
    .map(([acquirer, e]) => ({ acquirer, ...e }))
    .sort((a, b) => b.pv - a.pv);

  const vtMap = new Map<ViolationType, { n: number; pv: number }>();
  for (const m of merchants) {
    const e = vtMap.get(m.vt) ?? { n: 0, pv: 0 };
    e.n += 1;
    e.pv += m.pv;
    vtMap.set(m.vt, e);
  }
  const byViolation = [...vtMap.entries()]
    .map(([vt, e]) => ({ vt, ...e, severity: SEVERITY_OF[vt] }))
    .sort((a, b) => b.pv - a.pv);

  const jurMap = new Map<string, { n: number; pv: number }>();
  for (const m of merchants) {
    const e = jurMap.get(m.region) ?? { n: 0, pv: 0 };
    e.n += 1;
    e.pv += m.pv;
    jurMap.set(m.region, e);
  }
  const byJurisdiction = [...jurMap.entries()]
    .map(([region, e]) => ({ region, ...e }))
    .sort((a, b) => b.pv - a.pv);

  return {
    kpi: {
      surcharging: surcharging.length,
      violating,
      severe,
      potential: violating - severe,
      pv,
      ncaLow: violating * ncaLow,
      ncaHigh: violating * ncaHigh,
    },
    byAcquirer,
    byViolation,
    byJurisdiction,
    merchants,
  };
}
