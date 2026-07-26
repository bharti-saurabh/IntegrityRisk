import type { MerchantRiskRecord, Transaction } from "@/types/domain";
import type { InvestigationBrief } from "./narrative";
import type { ExplorerMerchant } from "@/features/explorer/types";
import type { MiscodingCategory } from "@/data/miscodingCategories";
import { fmtPct, fmtCurrency } from "@/utils/format";
import { MCC_BY_CODE } from "@/data/mccTaxonomy";

// ---------------------------------------------------------------------------
// Agentic investigation script (plane-agnostic).
//
// Produces a DETERMINISTIC, ordered plan of investigative "steps" the UI plays
// back as a live stream. Two evidence planes:
//   • INTERNAL — grounded in the merchant's real scored features / transactions.
//   • OSINT    — SIMULATED over synthetic data. No live web calls are made (the
//                public demo has no server or keys). Every OSINT line is labeled.
//
// `buildInvestigation` runs on a normalized InvestigationSubject, so the same
// agent works from the live engine (Plane A: MerchantRiskRecord) and the
// generated cohort data (Plane B: ExplorerMerchant). Nothing here uses
// Math.random / Date.now — values are seeded from the merchant id.
// ---------------------------------------------------------------------------

export type StreamSource = "reasoning" | "internal" | "osint";
export type Verdict = "corroborates" | "mitigates" | "neutral";

export interface StreamLine {
  text: string;
  cite?: string;
  tone?: "flag" | "ok" | "muted";
}

// At-a-glance evidence attached to a step, rendered as gauges / badges so the
// stream reads visually instead of as a wall of prose.
export interface StreamMetric {
  label: string;
  value: string;
  bar?: number; // 0..1 → mini gauge fill; omit for badge-style metrics
  tone?: "flag" | "ok" | "muted";
  kind?: "gauge" | "badge";
}

export interface AgentStep {
  id: string;
  lane: "Plan" | "Internal data" | "OSINT" | "Synthesis";
  tool: string;
  icon: string;
  source: StreamSource;
  action: string;
  lines: StreamLine[];
  metrics?: StreamMetric[];
  verdict?: Verdict;
  durationMs: number;
}

export interface SubjectFeatures {
  cnp: number;
  cashEquiv: number;
  roundDollar: number;
  recurring?: number;
  crossBorder?: number;
  chargebackBps?: number;
  refundRate?: number;
  avgTicket?: number;
  night?: number;
  thresholdProximity?: number;
  peerNightZ?: number;
  peerCnpZ?: number;
  divergence?: number;
  sharedBank?: number;
  submerchants?: number;
  sharedIp?: number;
  sharedDevice?: number;
  subMerchantTxnPct?: number;
  nDescriptors?: number;
}

export interface InvestigationSubject {
  merchantId: string;
  name: string;
  legalName: string;
  declaredMcc: string;
  declaredLabel: string;
  /** Suspected category + model score (0..100). */
  suspected: { key: string; label: string; behavesLike: string; score: number };
  highRisk: boolean;
  features: SubjectFeatures;
  cashTxSample?: number;
  rules: string[];
  synthesis: { hypothesis: string; recommended: string; disposition: string; confidence: number; confidenceLabel: string };
}

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const TLDS = [".com", ".io", ".co", ".net", ".biz", ".live"];
const REGISTRARS = ["NameCheap (privacy)", "Njalla (anonymized)", "Tucows", "GoDaddy (privacy)", "Porkbun (privacy)"];
const HOSTS = ["Cloudflare → offshore origin", "OVH (SC)", "DigitalOcean (SGP)", "Hetzner (DE)", "AWS (proxied)"];

// Per-category OSINT flavor — what a web / registry probe would surface.
const OSINT_FLAVOR: Record<string, { web: string[]; registry: string; media: string }> = {
  adult: {
    web: ["age-verification gate on landing page", "adult / companionship content indicators", "off-site billing descriptor mismatch"],
    registry: "registered as 'media & marketing services' — no adult-entertainment license on file",
    media: "forum reports of surprise recurring charges under an unrelated descriptor",
  },
  dating_escort: {
    web: ["profile / matchmaking UI", "companionship & 'meet tonight' calls-to-action", "billed under a neutral descriptor"],
    registry: "registered as 'social networking' — beneficial owner shielded",
    media: "complaint-board threads citing coercive recurring billing",
  },
  gambling: {
    web: ["live odds / wager UI detected", "'deposit' & 'stake' calls-to-action", "geo-blocked outside licensed jurisdictions"],
    registry: "registered as 'entertainment software' — no gaming operator license located",
    media: "listed on two player-complaint boards for withheld withdrawals",
  },
  game_of_skill: {
    web: ["paid entry-fee contest lobby", "cash-prize leaderboards", "skill-vs-chance disclaimer buried in terms"],
    registry: "registered as 'software publishing' — no contest / sweepstakes registration",
    media: "disputes over prize payouts across regional boards",
  },
  pharma: {
    web: ["supplement / Rx catalogue with 'free trial' upsell", "auto-ship terms buried in footer", "no verifiable pharmacy license badge"],
    registry: "registered as 'health & wellness retail' — not a licensed pharmacy",
    media: "consumer-protection thread alleging non-cancellable subscriptions",
  },
  nutra_subscription: {
    web: ["'risk-free trial' funnel", "hidden auto-renew and restocking fees", "testimonial-heavy single-product page"],
    registry: "registered as 'direct marketing' — high complaint velocity",
    media: "BBB-style pattern of unauthorized rebills",
  },
  crypto_cash: {
    web: ["wallet top-up / on-ramp widget", "crypto asset price tickers", "KYC step appears optional"],
    registry: "registered as 'computer services' — no money-services-business (MSB) registration found",
    media: "chain-analysis mention adjacent to a flagged exchange cluster",
  },
  financial_trading: {
    web: ["leveraged trading / CFD dashboard", "'fund your account' deposit flow", "risk warning present but licensing unclear"],
    registry: "registered as 'business consulting' — no securities / brokerage license located",
    media: "regulator watch-list mention in one jurisdiction",
  },
  cyberlocker: {
    web: ["file-hosting / premium-download paywall", "affiliate reward program for uploads", "DMCA notices referenced"],
    registry: "registered as 'web hosting' — repeat IP-abuse complaints",
    media: "rights-holder takedown coverage",
  },
  telemarketing: {
    web: ["inbound-offer landing page tied to call scripts", "membership / continuity club terms", "no clear cancellation path"],
    registry: "registered as 'teleservices' — elevated UDAAP complaint volume",
    media: "state AG mention for deceptive continuity billing",
  },
  tobacco_vape: {
    web: ["vape / nicotine product catalogue", "age-gate present but bypassable", "flavored-product listings"],
    registry: "registered as 'general retail' — no tobacco license on file",
    media: "youth-access enforcement mention",
  },
};

function osintFor(key: string) {
  return OSINT_FLAVOR[key] ?? OSINT_FLAVOR.crypto_cash;
}

export function buildInvestigation(subject: InvestigationSubject): AgentStep[] {
  const s = subject;
  const f = s.features;
  const flavor = osintFor(s.suspected.key);
  const seed = seedFrom(s.merchantId);

  const domainAge = 25 + (seed % 760);
  const domainYoung = domainAge < 365;
  const tld = TLDS[seed % TLDS.length];
  const registrar = REGISTRARS[(seed >>> 3) % REGISTRARS.length];
  const host = HOSTS[(seed >>> 6) % HOSTS.length];
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "merchant";

  const linked = (f.sharedBank ?? 0) + (f.submerchants ?? 0);
  const steps: AgentStep[] = [];

  // ---- PLAN ---------------------------------------------------------------
  steps.push({
    id: "plan",
    lane: "Plan",
    tool: "Investigation planner",
    icon: "Sparkles",
    source: "reasoning",
    action: "Decomposing the alert into an investigation plan…",
    durationMs: 900,
    lines: [
      { text: `Objective: test whether "${s.name}" (declared ${s.declaredMcc} · ${s.declaredLabel}) is operating as a higher-risk business type.` },
      { text: `Hypothesis: this merchant is a ${s.suspected.label} miscoded as a benign category — model score ${Math.round(s.suspected.score)}/100.`, tone: "flag" },
      { text: "Plan: (1) internal transaction & graph forensics, (2) simulated OSINT on web / domain / registry / watchlists, (3) synthesize a cited verdict." },
    ],
  });

  // ---- INTERNAL: transaction forensics -----------------------------------
  steps.push({
    id: "txn",
    lane: "Internal data",
    tool: "Transaction forensics",
    icon: "Activity",
    source: "internal",
    action: "Replaying the transaction ledger…",
    durationMs: 1100,
    verdict: "corroborates",
    metrics: [
      { label: "Card-not-present", value: fmtPct(f.cnp), bar: f.cnp, tone: f.cnp > 0.8 ? "flag" : "muted", kind: "gauge" },
      { label: "Quasi-cash", value: fmtPct(f.cashEquiv), bar: f.cashEquiv, tone: f.cashEquiv > 0.1 ? "flag" : "muted", kind: "gauge" },
      { label: "Round-dollar", value: fmtPct(f.roundDollar), bar: f.roundDollar, tone: f.roundDollar > 0.15 ? "flag" : "muted", kind: "gauge" },
      ...(f.avgTicket != null ? [{ label: "Avg ticket", value: fmtCurrency(f.avgTicket), kind: "badge" as const, tone: "muted" as const }] : []),
      ...(f.chargebackBps != null ? [{ label: "Chargebacks", value: `${Math.round(f.chargebackBps)} bps`, kind: "badge" as const, tone: (f.chargebackBps > 50 ? "flag" : "muted") as "flag" | "muted" }] : []),
    ],
    lines: [
      { text: `${fmtPct(f.cnp)} card-not-present${f.night != null ? ` · ${fmtPct(f.night)} overnight` : ""} — inconsistent with an in-person ${s.declaredLabel}.`, cite: "CNP", tone: f.cnp > 0.8 ? "flag" : "muted" },
      { text: `${fmtPct(f.cashEquiv)} quasi-cash and ${fmtPct(f.roundDollar)} round-dollar tickets${s.cashTxSample != null ? ` (${s.cashTxSample} cash-marked in the sample)` : ""}.`, cite: "QUASI", tone: f.cashEquiv > 0.1 ? "flag" : "muted" },
      {
        text: `Average ticket ${f.avgTicket != null ? fmtCurrency(f.avgTicket) : "n/a"}${f.thresholdProximity != null ? `; ${fmtPct(f.thresholdProximity)} sit just under the monitoring threshold` : ""}${f.chargebackBps != null ? `; chargebacks ${Math.round(f.chargebackBps)} bps` : ""}.`,
        cite: "TICKET",
        tone: (f.chargebackBps ?? 0) > 50 ? "flag" : "muted",
      },
    ],
  });

  // ---- INTERNAL: model / cohort signals ----------------------------------
  const peerAvailable = f.peerNightZ != null || f.peerCnpZ != null;
  steps.push({
    id: "signals",
    lane: "Internal data",
    tool: peerAvailable ? "Peer-cohort deviation" : "Model & cohort signals",
    icon: "Gauge",
    source: "internal",
    action: "Comparing against the declared-code peer cohort…",
    durationMs: 950,
    verdict: "corroborates",
    metrics: peerAvailable
      ? [
          { label: "Night z-score", value: `${(f.peerNightZ ?? 0).toFixed(1)}σ`, kind: "badge", tone: Math.abs(f.peerNightZ ?? 0) > 2 ? "flag" : "muted" },
          { label: "CNP z-score", value: `${(f.peerCnpZ ?? 0).toFixed(1)}σ`, kind: "badge", tone: Math.abs(f.peerCnpZ ?? 0) > 2 ? "flag" : "muted" },
          { label: "Divergence", value: (f.divergence ?? 0).toFixed(2), bar: Math.min(1, f.divergence ?? 0), kind: "gauge", tone: (f.divergence ?? 0) > 0.3 ? "flag" : "muted" },
        ]
      : [
          { label: "Model score", value: `${Math.round(s.suspected.score)}/100`, bar: s.suspected.score / 100, kind: "gauge", tone: "flag" },
          { label: "Cross-border", value: fmtPct(f.crossBorder ?? 0), bar: f.crossBorder ?? 0, kind: "gauge", tone: (f.crossBorder ?? 0) > 0.3 ? "flag" : "muted" },
          { label: "Recurring", value: fmtPct(f.recurring ?? 0), bar: f.recurring ?? 0, kind: "gauge", tone: "muted" },
        ],
    lines: peerAvailable
      ? [
          { text: `Night z-score ${(f.peerNightZ ?? 0).toFixed(1)}σ · CNP z-score ${(f.peerCnpZ ?? 0).toFixed(1)}σ vs declared-code peers.`, cite: "PEER", tone: Math.abs(f.peerNightZ ?? 0) > 2 ? "flag" : "muted" },
          { text: `Behavioral divergence from the declared profile scores ${(f.divergence ?? 0).toFixed(2)}.`, cite: "DIVERGENCE", tone: (f.divergence ?? 0) > 0.3 ? "flag" : "muted" },
        ]
      : [
          { text: `Integrity model score ${Math.round(s.suspected.score)}/100 places this merchant in the ${s.suspected.label} suspect cohort.`, cite: "MODEL", tone: "flag" },
          { text: `Corroborating ratios — cross-border ${fmtPct(f.crossBorder ?? 0)}, recurring ${fmtPct(f.recurring ?? 0)}, refunds ${fmtPct(f.refundRate ?? 0)}.`, cite: "RATIOS", tone: "muted" },
        ],
  });

  // ---- INTERNAL: entity & settlement graph -------------------------------
  const graphLines: StreamLine[] =
    linked > 0
      ? [
          { text: `Settlement account shared with ${f.sharedBank ?? 0} other merchant(s); ${f.submerchants ?? 0} undisclosed submerchant identit(ies) route through this entity.`, cite: "GRAPH", tone: "flag" },
          { text: `${f.sharedIp ?? 0} shared-IP and ${f.sharedDevice ?? 0} shared-device links observed across the portfolio.`, cite: "GRAPH", tone: (f.sharedIp ?? 0) > 0 ? "flag" : "muted" },
        ]
      : f.subMerchantTxnPct != null && f.subMerchantTxnPct > 0
        ? [
            { text: `${fmtPct(f.subMerchantTxnPct)} of transactions route through undisclosed sub-merchants.`, cite: "GRAPH", tone: "flag" },
            { text: `${f.nDescriptors ?? 1} distinct billing descriptor(s) observed for this entity.`, cite: "GRAPH", tone: (f.nDescriptors ?? 1) > 2 ? "flag" : "muted" },
          ]
        : [{ text: "No shared settlement accounts or undisclosed submerchants detected in the graph.", tone: "ok" }];
  steps.push({
    id: "graph",
    lane: "Internal data",
    tool: "Entity & settlement graph",
    icon: "Share2",
    source: "internal",
    action: "Traversing shared settlement, device and IP edges…",
    durationMs: 1050,
    verdict: linked > 0 || (f.subMerchantTxnPct ?? 0) > 0 ? "corroborates" : "neutral",
    metrics:
      linked > 0
        ? [
            { label: "Shared accounts", value: String(f.sharedBank ?? 0), kind: "badge", tone: (f.sharedBank ?? 0) > 0 ? "flag" : "muted" },
            { label: "Submerchants", value: String(f.submerchants ?? 0), kind: "badge", tone: (f.submerchants ?? 0) > 0 ? "flag" : "muted" },
            { label: "Shared IPs", value: String(f.sharedIp ?? 0), kind: "badge", tone: (f.sharedIp ?? 0) > 0 ? "flag" : "muted" },
            { label: "Shared devices", value: String(f.sharedDevice ?? 0), kind: "badge", tone: (f.sharedDevice ?? 0) > 0 ? "flag" : "muted" },
          ]
        : f.subMerchantTxnPct != null
          ? [
              { label: "Sub-merchant txns", value: fmtPct(f.subMerchantTxnPct), bar: f.subMerchantTxnPct, kind: "gauge", tone: f.subMerchantTxnPct > 0 ? "flag" : "muted" },
              { label: "Descriptors", value: String(f.nDescriptors ?? 1), kind: "badge", tone: (f.nDescriptors ?? 1) > 2 ? "flag" : "muted" },
            ]
          : [{ label: "Graph edges", value: "None", kind: "badge", tone: "ok" }],
    lines: graphLines,
  });

  // ---- INTERNAL: rule engine ---------------------------------------------
  steps.push({
    id: "rules",
    lane: "Internal data",
    tool: "Rule engine replay",
    icon: "Filter",
    source: "internal",
    action: "Re-evaluating deterministic rules…",
    durationMs: 750,
    verdict: s.rules.length > 0 ? "corroborates" : "neutral",
    lines:
      s.rules.length > 0
        ? s.rules.slice(0, 3).map((r) => ({ text: `${r} fired.`, cite: "RULE", tone: "flag" as const }))
        : [{ text: "No deterministic rule fired — the signal is model-driven, so corroboration leans on OSINT.", tone: "muted" }],
  });

  // ---- OSINT (simulated) --------------------------------------------------
  steps.push({
    id: "web",
    lane: "OSINT",
    tool: "Website & checkout probe",
    icon: "Globe",
    source: "osint",
    action: `Fetching ${slug}${tld} and inspecting the checkout flow…`,
    durationMs: 1250,
    verdict: "corroborates",
    metrics: [
      { label: "Storefront", value: `${slug}${tld}`, kind: "badge", tone: "muted" },
      { label: "Content match", value: s.suspected.label, kind: "badge", tone: "flag" },
      { label: "Descriptor", value: "Mismatch", kind: "badge", tone: "flag" },
    ],
    lines: [
      { text: `Storefront ${slug}${tld}: ${flavor.web[0]}.`, cite: "WEB", tone: "flag" },
      { text: `${flavor.web[1]}; ${flavor.web[2]}.`, cite: "WEB", tone: "flag" },
      { text: `Public content is inconsistent with a ${s.declaredLabel}.`, cite: "WEB" },
    ],
  });

  steps.push({
    id: "whois",
    lane: "OSINT",
    tool: "Domain age & WHOIS",
    icon: "Clock",
    source: "osint",
    action: "Resolving registration date, registrar and hosting geo…",
    durationMs: 900,
    verdict: domainYoung ? "corroborates" : "mitigates",
    metrics: [
      { label: "Domain age", value: `${domainAge} d`, kind: "badge", tone: domainYoung ? "flag" : "ok" },
      { label: "Registrar", value: registrar.split(" ")[0], kind: "badge", tone: "muted" },
      { label: "Hosting", value: host.split(" ")[0], kind: "badge", tone: "muted" },
    ],
    lines: [
      { text: `Domain registered ~${domainAge} days ago${domainYoung ? " — younger than the declared trading history" : " — established history"}.`, cite: "WHOIS", tone: domainYoung ? "flag" : "ok" },
      { text: `Registrar: ${registrar}. Hosting: ${host}.`, cite: "WHOIS", tone: "muted" },
    ],
  });

  steps.push({
    id: "registry",
    lane: "OSINT",
    tool: "Business registry & UBO",
    icon: "Landmark",
    source: "osint",
    action: "Cross-referencing corporate registry & beneficial owners…",
    durationMs: 1050,
    verdict: "corroborates",
    lines: [
      { text: `${s.legalName}: ${flavor.registry}.`, cite: "REGISTRY", tone: "flag" },
      linked > 0
        ? { text: `Registered officer overlaps with ${Math.max(1, f.sharedBank ?? 1)} other flagged merchant record(s) — consistent with the settlement graph.`, cite: "REGISTRY", tone: "flag" }
        : { text: "Beneficial owner shows no overlap with other flagged records.", cite: "REGISTRY", tone: "muted" },
    ],
  });

  steps.push({
    id: "watchlist",
    lane: "OSINT",
    tool: "Sanctions / MATCH / adverse media",
    icon: "ShieldAlert",
    source: "osint",
    action: "Screening watchlists and scanning adverse media…",
    durationMs: 1150,
    verdict: s.highRisk ? "corroborates" : "mitigates",
    metrics: [
      { label: "MATCH / TMF", value: s.highRisk ? "Hit" : "Clear", kind: "badge", tone: s.highRisk ? "flag" : "ok" },
      { label: "OFAC / sanctions", value: "Clear", kind: "badge", tone: "ok" },
      { label: "Adverse media", value: s.highRisk ? "Found" : "None", kind: "badge", tone: s.highRisk ? "flag" : "ok" },
    ],
    lines: s.highRisk
      ? [
          { text: "Prior MATCH (TMF) termination match on a related descriptor — reason code 12 (fraud).", cite: "MATCH", tone: "flag" },
          { text: `Adverse media: ${flavor.media}.`, cite: "MEDIA", tone: "flag" },
          { text: "No OFAC / sanctions hit.", cite: "OFAC", tone: "ok" },
        ]
      : [
          { text: "No MATCH (TMF) termination record located.", cite: "MATCH", tone: "ok" },
          { text: "No OFAC / sanctions hit; no material adverse media.", cite: "OFAC", tone: "ok" },
        ],
  });

  // ---- SYNTHESIS ----------------------------------------------------------
  const corr = steps.filter((st) => st.verdict === "corroborates").length;
  steps.push({
    id: "synthesis",
    lane: "Synthesis",
    tool: "Synthesis & disposition",
    icon: "Scale",
    source: "reasoning",
    action: "Weighing internal + OSINT evidence into a verdict…",
    durationMs: 1200,
    verdict: "corroborates",
    lines: [
      { text: `${corr} of ${steps.length} lanes corroborate the hypothesis: behaves like ${s.suspected.behavesLike}, declared under a benign ${s.declaredMcc} code.`, tone: "flag" },
      { text: s.synthesis.hypothesis },
      { text: `Recommended: ${s.synthesis.recommended}`, cite: "ACTION" },
      { text: `Suggested disposition: ${s.synthesis.disposition}`, cite: "ACTION" },
      { text: `Confidence ${fmtPct(s.synthesis.confidence)} (${s.synthesis.confidenceLabel}). Decision-support only — a named human signs off.`, tone: "muted" },
    ],
  });

  return steps;
}

// ---- Adapters -------------------------------------------------------------

/** Plane A — the live scoring engine's record + its narrative brief. */
export function subjectFromRecord(
  record: MerchantRiskRecord,
  transactions: Transaction[],
  brief: InvestigationBrief,
): InvestigationSubject {
  const m = record.merchant;
  const f = record.features;
  const top = record.archetypeMatches[0];
  return {
    merchantId: m.merchantId,
    name: m.tradeName,
    legalName: m.legalName,
    declaredMcc: m.declaredMcc,
    declaredLabel: MCC_BY_CODE[m.declaredMcc]?.category ?? m.declaredMcc,
    suspected: { key: top.key, label: `${top.short.toLowerCase()} operator`, behavesLike: top.label.toLowerCase(), score: top.similarity },
    highRisk: record.scores.tier === "critical" || record.scores.tier === "high",
    features: {
      cnp: f.cardNotPresentRatio,
      cashEquiv: f.cashEquivalentRatio,
      roundDollar: f.roundDollarRatio,
      recurring: f.repeatCardRatio,
      crossBorder: f.crossBorderRatio,
      chargebackBps: f.disputeRate * 10000,
      refundRate: f.refundRate,
      avgTicket: f.avgTicket,
      night: f.nightRatio,
      thresholdProximity: f.thresholdProximityRatio,
      peerNightZ: f.peerNightZ,
      peerCnpZ: f.peerCnpZ,
      divergence: f.mccDivergence,
      sharedBank: f.sharedBankAccountCount,
      submerchants: f.submerchantCount,
      sharedIp: f.sharedIpCount,
      sharedDevice: f.sharedDeviceCount,
      nDescriptors: f.descriptorCount,
    },
    cashTxSample: transactions.filter((t) => t.cashEquivalent).length,
    rules: record.ruleHits.map((h) => `${h.name} (${h.severity}, +${h.score})`),
    synthesis: {
      hypothesis: brief.primaryHypothesis,
      recommended: brief.recommendedSteps[0] ?? "escalate for analyst review",
      disposition: brief.suggestedDisposition,
      confidence: brief.confidence,
      confidenceLabel: brief.confidenceLabel,
    },
  };
}

/** Plane B — a generated cohort row + the category model that surfaced it. */
export function subjectFromExplorer(m: ExplorerMerchant, category: MiscodingCategory): InvestigationSubject {
  const score = m.integrity_risk_score;
  const disposition =
    m.risk_tier === "Critical" || m.risk_tier === "High"
      ? `Escalate to ${category.owner}; freeze new MIDs pending ${category.subtype} attestation.`
      : `Queue for ${category.owner} review; request attestation and business-model evidence.`;
  return {
    merchantId: m.merchant_id,
    name: m.merchant_name,
    legalName: m.corp_name,
    declaredMcc: String(m.declared_mcc),
    declaredLabel: m.mcc_group,
    suspected: { key: category.key, label: `${category.short.toLowerCase()} operator`, behavesLike: category.behavesLike, score },
    highRisk: m.risk_tier === "Critical" || m.risk_tier === "High",
    features: {
      cnp: m.pct_cnp,
      cashEquiv: m.pct_quasi_cash,
      roundDollar: m.pct_round_100,
      recurring: m.pct_recurring,
      crossBorder: m.pct_cross_border,
      chargebackBps: m.chargeback_rate_bps,
      refundRate: m.refund_rate_amount,
      avgTicket: m.avg_ticket_usd,
      subMerchantTxnPct: m.pct_txn_with_sub_merchant,
      nDescriptors: m.n_distinct_descriptors,
    },
    rules: m.rule_names && m.rule_names !== "None" ? m.rule_names.split(/\s*[,;|]\s*/).filter(Boolean) : [],
    synthesis: {
      hypothesis: `Behavioral profile matches ${category.behavesLike}; declared under ${m.mcc_group}. This is the ${category.subtype} miscoding pattern.`,
      recommended: `Route to ${category.owner} for ${category.subtype} attestation.`,
      disposition,
      confidence: Math.min(0.99, score / 100),
      confidenceLabel: score >= 80 ? "high" : score >= 55 ? "moderate" : "tentative",
    },
  };
}
