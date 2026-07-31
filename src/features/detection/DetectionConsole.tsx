import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip, Legend,
} from "recharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, Button, EmptyState } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { CHART } from "@/components/charts/kit";
import { fmtCurrency, fmtCompact, fmtNumber } from "@/utils/format";
import { useExplorerMerchants } from "@/features/explorer/useMerchants";
import type { ExplorerMerchant } from "@/features/explorer/types";
import {
  PRIORITY_ORDER, PRIORITY_LABEL, PRIORITY_HEX,
  formatSignal, isElevated,
  CNP, QUASI, ROUND, RECUR, XBORDER, CB, REFUND, TICKET, DESC,
  type CategorySignal,
} from "@/data/miscodingCategories";
import type { TypologyConfig, DetectionModel } from "@/data/typologies";
import {
  assessSurcharge, buildSurchargePortfolio, violationHex,
  type SurchargeAssessment,
} from "@/data/surchargeCompliance";
import { TIER_HEX, TIER_ORDER, FAMILY_META, type OverviewTier, type FamilyKey } from "@/data/overview";
import { subjectFromExplorer, buildInvestigation } from "@/features/ai-copilot/agentStream";
import { AgentStreamPanel } from "@/features/ai-copilot/AgentStreamPanel";
import { useAppStore } from "@/stores/appStore";

// The deterministic verdict the agent settles on — reused for the pinned
// findings card so the dossier shows the same synthesis the drawer streamed.
type InvestigationSynthesis = ReturnType<typeof subjectFromExplorer>["synthesis"];

// ---------------------------------------------------------------------------
// Reusable detection-model console. Every integrity typology renders through
// this component (see src/data/typologies.ts): pick an identification model →
// pull its cohort of miscoded/disguised merchants → work the remediation queue,
// with per-merchant peer-deviation evidence + an autonomous AI investigation.
// Reads Plane B (generated merchants.json), the only plane carrying the
// per-merchant category taxonomy.
// ---------------------------------------------------------------------------

function cohortFor(merchants: ExplorerMerchant[], family: string, modelKey: string): ExplorerMerchant[] {
  return merchants
    .filter((m) => m.family === family && m.top_category === modelKey)
    .sort((a, b) => b.integrity_risk_score - a.integrity_risk_score);
}

function TierDot({ tier }: { tier: OverviewTier }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TIER_HEX[tier] }} />;
}

// ---- peer-deviation statistics --------------------------------------------
// Baseline = legitimate merchants declaring the SAME MCC group. Each signal is a
// z-score against that peer mean, so we can show how far a merchant sits from its
// declared-category average and its 3σ envelope.

interface SignalStat {
  sig: CategorySignal;
  observed: number;
  mean: number;
  std: number;
  z: number;
  ceiling: number; // peer mean + 3σ
  pct: number; // percentile of observed within the peer population (0..1)
  sample: number[]; // peer observed values, for the distribution plot
  contribution?: number; // model log-odds contribution (driver-routed merchants only)
  share?: number; // fraction of the score's upward push (0..1)
}

// Two interchange features carry model weight but aren't in the typology signal
// catalog, so define their display metadata here. Both read "higher = more
// suspicious" after the model's orientation, matching the σ-deviation viz.
const IADV: CategorySignal = { key: "interchange_advantage_bps", label: "Interchange advantage", kind: "bps", elevated: 0 };
const IEFF: CategorySignal = { key: "effective_interchange_bps", label: "Effective interchange", kind: "bps", elevated: 250 };

// Feature-key → display metadata, so a merchant's model DRIVERS (which vary per
// merchant) can be rendered on the same peer-deviation charts as the fixed
// per-typology signal lens.
const SIGNAL_BY_KEY: Partial<Record<keyof ExplorerMerchant, CategorySignal>> = {
  pct_cnp: CNP, pct_quasi_cash: QUASI, pct_round_100: ROUND, pct_recurring: RECUR,
  pct_cross_border: XBORDER, chargeback_rate_bps: CB, refund_rate_amount: REFUND,
  avg_ticket_usd: TICKET, n_distinct_descriptors: DESC,
  interchange_advantage_bps: IADV, effective_interchange_bps: IEFF,
};

// Some declared MCCs are restricted, not benign — the synthetic data groups MCC
// 7273 under "Adult", but it is a Dating & Escort code. Correct the DISPLAY of
// the declared category (peer grouping still uses the raw mcc_group) so the
// "declared as" framing doesn't call a restricted code benign.
const RESTRICTED_MCC: Record<number, { group: string; kind: string }> = {
  7273: { group: "Dating & Escort", kind: "a restricted dating/escort MCC" },
};
function declaredDisplay(m: ExplorerMerchant, config: TypologyConfig): { group: string; kind: string } {
  return RESTRICTED_MCC[m.declared_mcc] ?? { group: m.mcc_group, kind: config.declaredKind };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / xs.length);
}

function peerPopulation(merchants: ExplorerMerchant[], group: string): ExplorerMerchant[] {
  const clean = merchants.filter((m) => m.mcc_group === group && m.label === "clean");
  if (clean.length >= 8) return clean;
  const grp = merchants.filter((m) => m.mcc_group === group);
  if (grp.length >= 8) return grp;
  return merchants;
}

function computeStats(merchants: ExplorerMerchant[], m: ExplorerMerchant, model: DetectionModel): SignalStat[] {
  const peers = peerPopulation(merchants, m.mcc_group);
  return model.signals.map((sig) => {
    const xs = peers.map((p) => p[sig.key] as number).filter((v) => typeof v === "number" && isFinite(v));
    const mean = avg(xs);
    // Floor σ to a fraction of the signal's own scale so near-constant peers
    // don't produce absurd z-scores.
    const std = Math.max(stdev(xs, mean), sig.elevated * 0.12);
    const observed = m[sig.key] as number;
    const z = (observed - mean) / std;
    const pct = xs.length ? xs.filter((v) => v <= observed).length / xs.length : 1;
    return { sig, observed, mean, std, z, ceiling: mean + 3 * std, pct, sample: xs };
  });
}

// Dynamic-axis variant: instead of the fixed per-typology signal lens, plot the
// features the MODEL actually leaned on for THIS merchant (its score drivers, in
// contribution order). Peer-deviation stats are recomputed here so the charts
// stay internally consistent; each stat also carries the model's stored
// contribution/share for the score decomposition. Model-routed merchants only.
function driverStats(merchants: ExplorerMerchant[], m: ExplorerMerchant): SignalStat[] {
  const peers = peerPopulation(merchants, m.mcc_group);
  return (m.drivers ?? [])
    .map((d): SignalStat | null => {
      const sig = SIGNAL_BY_KEY[d.key];
      if (!sig) return null;
      const xs = peers.map((p) => p[d.key] as number).filter((v) => typeof v === "number" && isFinite(v));
      const mean = avg(xs);
      const std = Math.max(stdev(xs, mean), sig.elevated * 0.12, 1e-9);
      const observed = m[d.key] as number;
      const z = (observed - mean) / std;
      const pct = xs.length ? xs.filter((v) => v <= observed).length / xs.length : 1;
      return { sig, observed, mean, std, z, ceiling: mean + 3 * std, pct, sample: xs, contribution: d.contribution, share: d.share };
    })
    .filter((s): s is SignalStat => s !== null);
}

// Peer baseline used for a merchant's z-scores, described for the confidence
// band: how many peers and whether we could stay within its declared vertical.
function peerContext(merchants: ExplorerMerchant[], group: string): { n: number; source: "clean-group" | "group" | "global" } {
  const clean = merchants.filter((m) => m.mcc_group === group && m.label === "clean");
  if (clean.length >= 8) return { n: clean.length, source: "clean-group" };
  const grp = merchants.filter((m) => m.mcc_group === group);
  if (grp.length >= 8) return { n: grp.length, source: "group" };
  return { n: merchants.filter((m) => m.label === "clean").length, source: "global" };
}

// Saturating map from σ-distance to a 0..1 track position. Real peer variance on
// "clean" merchants is near-zero for prohibited-behavior signals, so raw z-scores
// blow past 10σ+. A naive value/ceiling scale then pegs every bar to the same
// length. z/(z+k) keeps extreme values on-scale AND monotonically distinguishable.
const SIGMA_K = 6;
const THREE_SIGMA_POS = 3 / (3 + SIGMA_K); // ≈ 0.333 — boundary of the normal envelope
function sigmaPos(z: number): number {
  const zz = Math.max(0, z);
  return zz / (zz + SIGMA_K);
}
// Beyond ~10σ the exact figure is noise, so cap the displayed number rather than
// fabricate false precision on synthetic data.
function fmtSigma(z: number): string {
  const sign = z >= 0 ? "+" : "−";
  const a = Math.abs(z);
  return a >= 10 ? `${sign}10σ+` : `${sign}${a.toFixed(1)}σ`;
}

function zTone(z: number): { text: string; hex: string } {
  if (z >= 3) return { text: "text-critical", hex: "#dc2626" };
  if (z >= 2) return { text: "text-amber", hex: "#d97706" };
  return { text: "text-ink-2", hex: "#2563eb" };
}

// Deterministic follow-up answers grounded in the cohort row + detection model.
function cohortAnswer(promptId: string, m: ExplorerMerchant, model: DetectionModel, cfg: TypologyConfig): string {
  const elevated = model.signals.filter((s) => isElevated(s, m[s.key] as number));
  switch (promptId) {
    case "why":
      return `${m.merchant_name} is declared under ${m.mcc_group} (MCC ${m.declared_mcc}) but its behavioral profile matches ${model.behavesLike}. The ${model.short} model scores it ${m.integrity_risk_score.toFixed(1)}/100 (${m.risk_tier}). ${elevated.length} of ${model.signals.length} discriminative signals are elevated: ${elevated.map((s) => s.label).join(", ") || "none individually — composite-driven"}.`;
    case "signals":
      return model.signals
        .map((s) => `• ${s.label}: ${formatSignal(s, m[s.key] as number)} (elevated ≥ ${formatSignal(s, s.elevated)})${isElevated(s, m[s.key] as number) ? "  ⚑" : ""}`)
        .join("\n");
    case "declared":
      return `Declared: MCC ${m.declared_mcc} — ${m.mcc_group} (${cfg.declaredKind}). Observed behavior resembles ${model.behavesLike}. Flag basis: ${m.flag_reason}${m.rule_names && m.rule_names !== "None" ? ` (rules: ${m.rule_names})` : ""}.`;
    case "remediation":
      return `Route to ${model.owner}. Request a ${model.subtype} attestation and business-model evidence; if unsubstantiated, apply the ${model.priority} handling path. Exposure at stake: ${fmtCurrency(m.gross_sales_usd)} gross across ${fmtNumber(m.txn_count)} transactions.`;
    case "exposure":
      return `${m.merchant_name} carries ${fmtCurrency(m.gross_sales_usd)} gross across ${fmtNumber(m.txn_count)} transactions on ${fmtNumber(m.unique_cards)} unique cards. It sits in the ${m.risk_tier} tier at ${m.integrity_risk_score.toFixed(1)}/100 — this is the value at stake if the ${model.short} suspicion is confirmed.`;
    default:
      return `${m.merchant_name}: suspected ${model.short}, declared as ${m.mcc_group} (MCC ${m.declared_mcc}), scored ${m.integrity_risk_score.toFixed(1)}/100 (${m.risk_tier}). Ask about the signals, declared-vs-behavior, exposure, or remediation.`;
  }
}

// Keyword-route a free-text question to the closest grounded answer. Ordered so
// the more specific intents win before the catch-all "why". Falls through to a
// generic orientation answer (the switch default) when nothing matches.
function routeCohortQuestion(qRaw: string): string {
  const q = qRaw.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => q.includes(k));
  if (has("signal", "variable", "feature", "metric", "elevated", "sigma", "z-score", "z score", "deviat", "which stat")) return "signals";
  if (has("remediat", "next step", "what do", "what should", "action", "route", "owner", "team", "who handles", "who owns", "resolve", "fix it", "handle")) return "remediation";
  if (has("exposure", "how much", "dollar", "how many transaction", "volume", "gross", "sales", "value at stake", "size")) return "exposure";
  if (has("declared", "mcc", "code", "should be", "actually", "real category", "vs behav", "versus")) return "declared";
  // "why", "flag", "reason", "explain", "suspect" and anything unmatched.
  return "why";
}

const COHORT_PROMPTS = [
  { id: "why", label: "Why is this flagged?" },
  { id: "signals", label: "Show the signals" },
  { id: "declared", label: "Declared vs behavior" },
  { id: "remediation", label: "Remediation steps" },
];

export function DetectionConsole({ config }: { config: TypologyConfig }) {
  const { category: routeParam } = useParams(); // URL selects the identification model
  const navigate = useNavigate();
  const { merchants, error } = useExplorerMerchants();
  const fileCase = useAppStore((s) => s.fileCase);
  const filedCases = useAppStore((s) => s.filedCases);

  const modelByKey = useMemo(() => {
    const map: Record<string, DetectionModel> = {};
    for (const m of config.models) map[m.key] = m;
    return map;
  }, [config]);

  const initialKey = routeParam && modelByKey[routeParam] ? routeParam : config.models[0].key;
  const [modelKey, setModelKey] = useState(initialKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Investigation is now a slide-over drawer (not a full-panel swap): the
  // evidence dossier stays put underneath, and completed runs collapse to a
  // pinned findings card on the merchants that have been investigated.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [investigatedIds, setInvestigatedIds] = useState<Set<string>>(() => new Set());
  const [runId, setRunId] = useState(0);
  // Analyst triage on the model's flag: a merchant can be Cleared (false
  // positive) or Confirmed (escalate). Kept local to the console so it doesn't
  // perturb the persisted case store; filing a formal case is the durable path.
  const [dispositions, setDispositions] = useState<Map<string, "cleared" | "confirmed">>(() => new Map());
  const disposeMerchant = (id: string, d: "cleared" | "confirmed" | null) =>
    setDispositions((prev) => {
      const next = new Map(prev);
      if (d === null) next.delete(id); else next.set(id, d);
      return next;
    });
  // Local queue filters — how an analyst narrows the remediation list to what
  // they'll actually work. Kept out of the global store so they can't perturb
  // other consoles or the portfolio view.
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<OverviewTier | "all">("all");
  const [minSignals, setMinSignals] = useState(0);
  const [hideCased, setHideCased] = useState(false);
  const [sortBy, setSortBy] = useState<"risk" | "exposure" | "signals">("risk");
  // Progressive disclosure: the model rationale and the secondary filters both
  // start collapsed so the console opens compact and the queue/detail win the
  // vertical space (no more scrolling past a tall control band).
  const [showModelInfo, setShowModelInfo] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Reset to this family's first model whenever we switch consoles.
  useEffect(() => {
    setModelKey(routeParam && modelByKey[routeParam] ? routeParam : config.models[0].key);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = modelByKey[modelKey] ?? config.models[0];

  // Priorities actually present in this family, in P1→P3 order.
  const priorityGroups = useMemo(
    () => PRIORITY_ORDER.filter((p) => config.models.some((m) => m.priority === p)),
    [config],
  );

  // Keep URL in sync so a cohort is shareable / bookmarkable.
  useEffect(() => {
    if (routeParam !== modelKey) navigate(`${config.route}/${modelKey}`, { replace: true });
  }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-model cohort counts for the dropdown labels.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    if (merchants) for (const m of merchants) if (m.family === config.family) map[m.top_category] = (map[m.top_category] ?? 0) + 1;
    return map;
  }, [merchants, config.family]);

  const cohort = useMemo(
    () => (merchants ? cohortFor(merchants, config.family, modelKey) : []),
    [merchants, config.family, modelKey],
  );

  // Reset selection + filters when the model (and therefore the cohort) changes.
  useEffect(() => {
    setSelectedId(cohort[0]?.merchant_id ?? null);
    setDrawerOpen(false);
    setInvestigatedIds(new Set());
    setDispositions(new Map());
    setQuery("");
    setTierFilter("all");
    setMinSignals(0);
    setHideCased(false);
    setSortBy("risk");
    setShowFilters(false);
  }, [modelKey, cohort]);

  const selected = cohort.find((m) => m.merchant_id === selectedId) ?? cohort[0] ?? null;

  const summary = useMemo(() => {
    const exposure = cohort.reduce((s, m) => s + m.gross_sales_usd, 0);
    const acute = cohort.filter((m) => m.risk_tier === "Critical" || m.risk_tier === "High").length;
    const modelFlagged = cohort.filter((m) => m.flag_reason.includes("model")).length;
    return { exposure, avg: avg(cohort.map((m) => m.integrity_risk_score)), acute, modelFlagged };
  }, [cohort]);

  // How many of the model's discriminative signals are elevated for a merchant.
  const elevatedOf = (m: ExplorerMerchant) => model.signals.filter((s) => isElevated(s, m[s.key] as number)).length;

  // Tiers actually present in this cohort, in severity order — drives the chips.
  const presentTiers = useMemo(
    () => TIER_ORDER.filter((t) => cohort.some((m) => m.risk_tier === t)),
    [cohort],
  );

  // Filtered + sorted queue. Selection stays on the raw cohort, so a merchant
  // filtered out of the list is still viewable if it was already open.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = cohort.filter((m) => {
      if (tierFilter !== "all" && m.risk_tier !== tierFilter) return false;
      if (minSignals > 0 && elevatedOf(m) < minSignals) return false;
      if (hideCased && filedCases.some((c) => c.merchantId === m.merchant_id)) return false;
      if (q && !(
        m.merchant_name.toLowerCase().includes(q) ||
        m.merchant_id.toLowerCase().includes(q) ||
        m.mcc_group.toLowerCase().includes(q)
      )) return false;
      return true;
    });
    if (sortBy === "exposure") return [...list].sort((a, b) => b.gross_sales_usd - a.gross_sales_usd);
    if (sortBy === "signals") return [...list].sort((a, b) => elevatedOf(b) - elevatedOf(a) || b.integrity_risk_score - a.integrity_risk_score);
    return list; // cohort already sorted by risk
  }, [cohort, tierFilter, minSignals, hideCased, query, sortBy, filedCases, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive = query.trim() !== "" || tierFilter !== "all" || minSignals > 0 || hideCased;
  // Count only the collapsible facets (search stays visible) for the "Filters (n)" badge.
  const activeFilterCount = (tierFilter !== "all" ? 1 : 0) + (minSignals > 0 ? 1 : 0) + (hideCased ? 1 : 0);
  const resetFilters = () => { setQuery(""); setTierFilter("all"); setMinSignals(0); setHideCased(false); };

  // Model-routed merchants (MCC-miscoding) carry per-merchant score drivers, so
  // the deviation charts use THOSE features as axes. Rule-routed families fall
  // back to the fixed per-typology signal lens.
  const stats = useMemo(() => {
    if (!merchants || !selected) return [];
    return selected.drivers && selected.drivers.length
      ? driverStats(merchants, selected)
      : computeStats(merchants, selected, model);
  }, [merchants, selected, model]);

  // Lock background scroll + close the investigation drawer on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  if (error) return <EmptyState title="Couldn't load merchant data" hint={error} />;
  if (!merchants) return <EmptyState title="Loading detection models…" hint="Scoring the synthetic portfolio across the typology catalog." />;

  // Open the slide-over and (re)play the run; mark the merchant investigated so
  // its dossier keeps a pinned findings card after the drawer closes.
  const openInvestigation = () => {
    if (!selected) return;
    setInvestigatedIds((prev) => new Set(prev).add(selected.merchant_id));
    setRunId((n) => n + 1);
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div>
      <PageHeader icon={config.icon} title={config.title} subtitle={config.subtitle} />

      {/* ---- Compact control toolbar: selector + priority/owner + KPI chips - */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
          <div className="relative min-w-[220px] flex-1">
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              aria-label="Identification model"
              className="w-full appearance-none rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-9 text-[13px] font-semibold text-ink outline-none focus:border-cyan/50"
            >
              {priorityGroups.map((p) => (
                <optgroup key={p} label={`${p} · ${PRIORITY_LABEL[p]}`}>
                  {config.models.filter((m) => m.priority === p).map((m) => (
                    <option key={m.key} value={m.key}>
                      Merchants suspected {m.short} · {config.cohortSuffix}  ({counts[m.key] ?? 0})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Icon name="ChevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
          </div>

          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
            style={{ color: PRIORITY_HEX[model.priority], borderColor: `${PRIORITY_HEX[model.priority]}55`, background: `${PRIORITY_HEX[model.priority]}12` }}
          >
            {model.priority} · {PRIORITY_LABEL[model.priority]}
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2 md:inline-flex">
            <Icon name="Users" size={12} /> {model.owner}
          </span>

          <div className="ml-auto flex items-center gap-3.5 pl-1">
            <Kpi value={fmtNumber(cohort.length)} label="cohort" tone="text-cyan" />
            <Kpi value={fmtCompact(summary.exposure)} label="exposure" tone="text-amber" />
            <Kpi value={summary.avg.toFixed(1)} label="avg risk" tone="text-critical" />
            <Kpi value={fmtNumber(summary.acute)} label="crit/high" tone="text-violet" />
          </div>
        </div>

        <button
          onClick={() => setShowModelInfo((v) => !v)}
          className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          <Icon name="ChevronDown" size={12} className={`transition-transform ${showModelInfo ? "" : "-rotate-90"}`} />
          <span className="font-medium">How this model flags</span>
          <span className="truncate text-ink-3/70">— {config.behaveVerb} {model.behavesLike}</span>
        </button>
        {showModelInfo ? (
          <div className="border-t border-border bg-cyan/[0.03] px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            <b className="text-ink">{cohort.length}</b> merchant{cohort.length === 1 ? "" : "s"} {config.behaveVerb}{" "}
            <b className="text-ink">{model.behavesLike}</b> but are declared under {config.declaredKind}.{" "}
            <span className="text-ink-3">Signals:</span> {model.signals.map((s) => s.label).join(" · ")}.{" "}
            <span className="text-ink-3">{summary.modelFlagged} model-flagged · {fmtNumber(summary.acute)} critical/high.</span>
          </div>
        ) : null}
      </Card>

      {/* ---- Fee-integrity: whole-book NCA recovery lens ------------------- */}
      {config.family === "surcharge" && merchants ? (
        <SurchargePortfolioPanel merchants={merchants} />
      ) : null}

      {/* ---- Master / detail ---------------------------------------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* Cohort queue */}
        <Card className="flex max-h-[calc(100vh-96px)] flex-col p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <SectionLabel>Remediation queue</SectionLabel>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3 tnum">
                {visible.length === cohort.length ? `${cohort.length} merchants` : `${visible.length} of ${cohort.length}`}
              </span>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  aria-label="Sort queue"
                  className="appearance-none rounded-md border border-border bg-surface-2 py-1 pl-2 pr-6 text-[11px] font-medium text-ink-2 outline-none focus:border-cyan/50"
                >
                  <option value="risk">Risk</option>
                  <option value="exposure">Exposure</option>
                  <option value="signals">Signals</option>
                </select>
                <Icon name="ChevronDown" size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-3" />
              </div>
            </div>
          </div>

          {/* Queue filters — search stays visible; the facets collapse behind
              a "Filters (n)" disclosure with removable chips when collapsed. */}
          <div className="space-y-2 border-b border-border px-3 py-2.5">
            <div className="relative">
              <Icon name="Search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name, ID, or MCC group…"
                className="w-full rounded-lg border border-border bg-surface-2 py-1.5 pl-8 pr-7 text-[12px] text-ink outline-none focus:border-cyan/50 placeholder:text-ink-3"
              />
              {query ? (
                <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink">
                  <Icon name="X" size={13} />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink"
              >
                <Icon name="ChevronDown" size={12} className={`transition-transform ${showFilters ? "" : "-rotate-90"}`} />
                Filters
                {activeFilterCount > 0 ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan px-1 text-[9px] font-bold text-white tnum">{activeFilterCount}</span>
                ) : null}
              </button>

              {!showFilters && activeFilterCount > 0 ? (
                <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
                  {tierFilter !== "all" ? <ActiveChip onClear={() => setTierFilter("all")} dot={TIER_HEX[tierFilter]}>{tierFilter}</ActiveChip> : null}
                  {minSignals > 0 ? <ActiveChip onClear={() => setMinSignals(0)}>≥{minSignals} sig</ActiveChip> : null}
                  {hideCased ? <ActiveChip onClear={() => setHideCased(false)}>hiding filed</ActiveChip> : null}
                </div>
              ) : null}

              {filtersActive ? (
                <button onClick={resetFilters} className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
                  <Icon name="X" size={11} /> Clear
                </button>
              ) : null}
            </div>

            {showFilters ? (
              <div className="space-y-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="micro-label mr-1">Tier</span>
                  <FilterChip active={tierFilter === "all"} onClick={() => setTierFilter("all")}>All</FilterChip>
                  {presentTiers.map((t) => (
                    <FilterChip key={t} active={tierFilter === t} onClick={() => setTierFilter(t)} dot={TIER_HEX[t]}>{t}</FilterChip>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="micro-label mr-1">Signals ≥</span>
                  {Array.from({ length: model.signals.length + 1 }, (_, n) => n).map((n) => (
                    <FilterChip key={n} active={minSignals === n} onClick={() => setMinSignals(n)}>{n === 0 ? "Any" : n}</FilterChip>
                  ))}
                </div>
                <button
                  onClick={() => setHideCased((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-2 hover:text-ink"
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${hideCased ? "border-cyan bg-cyan text-white" : "border-border bg-surface-2"}`}>
                    {hideCased ? <Icon name="Check" size={10} /> : null}
                  </span>
                  Hide filed cases
                </button>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {cohort.length === 0 ? (
              <div className="p-6 text-center text-xs text-ink-3">No merchants in this cohort.</div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center">
                <div className="text-xs text-ink-3">No merchants match these filters.</div>
                <button onClick={resetFilters} className="text-[11px] font-medium text-cyan hover:underline">Clear filters</button>
              </div>
            ) : (
              visible.map((m) => {
                const active = m.merchant_id === selected?.merchant_id;
                const elevatedCount = elevatedOf(m);
                const cased = filedCases.some((c) => c.merchantId === m.merchant_id);
                return (
                  <button
                    key={m.merchant_id}
                    onClick={() => setSelectedId(m.merchant_id)}
                    className={`flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left transition-all ${active ? "bg-cyan/[0.06]" : "hover:bg-surface-2/60"}`}
                  >
                    <TierDot tier={m.risk_tier} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-ink">{m.merchant_name}</span>
                        {cased ? <Icon name="Check" size={12} className="shrink-0 text-ok" /> : null}
                      </div>
                      <div className="truncate text-[11px] text-ink-3">
                        {config.family === "surcharge"
                          ? `${m.merchant_city}, ${m.merchant_country} · ${(m.surcharge_rate_bps / 100).toFixed(1)}% surcharge`
                          : `declared ${m.declared_mcc} · ${m.mcc_group}`}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-bold tnum" style={{ color: TIER_HEX[m.risk_tier] }}>{m.integrity_risk_score.toFixed(0)}</span>
                      <span className="text-[10px] text-ink-3">{elevatedCount}/{model.signals.length} signals</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Detail */}
        <div className="min-w-0">
          {!selected ? (
            <EmptyState title="Select a merchant from the queue" hint="Each row is a merchant this model flags as potentially disguised." />
          ) : (
            <EvidencePanel
              merchant={selected}
              model={model}
              config={config}
              stats={stats}
              merchants={merchants}
              investigated={investigatedIds.has(selected.merchant_id)}
              onInvestigate={openInvestigation}
              disposition={dispositions.get(selected.merchant_id) ?? null}
              onDispose={(d) => disposeMerchant(selected.merchant_id, d)}
            />
          )}
        </div>
      </div>

      {/* ---- Investigation slide-over (agent runs here, dossier stays put) - */}
      <InvestigationDrawer open={drawerOpen} onClose={closeDrawer} title={selected?.merchant_name ?? ""}>
        {drawerOpen && selected ? (() => {
          const subject = subjectFromExplorer(selected, model);
          return (
            <AgentStreamPanel
              embedded
              steps={buildInvestigation(subject)}
              runId={runId}
              subjectName={selected.merchant_name}
              suspectedLabel={`${model.short.toLowerCase()} operator`}
              suspectedScore={selected.integrity_risk_score}
              declaredMcc={String(selected.declared_mcc)}
              disposition={subject.synthesis.disposition}
              recommended={subject.synthesis.recommended}
              hypothesis={subject.synthesis.hypothesis}
              confidence={subject.synthesis.confidence}
              confidenceLabel={subject.synthesis.confidenceLabel}
              scoreUnit="score"
              quickPrompts={COHORT_PROMPTS}
              onAsk={(promptId, freeText) => cohortAnswer(freeText ? routeCohortQuestion(freeText) : promptId, selected, model, config)}
              caseAction={{
                filed: filedCases.some((c) => c.merchantId === selected.merchant_id),
                onFile: () =>
                  fileCase({
                    merchantId: selected.merchant_id,
                    merchantName: selected.merchant_name,
                    familyLabel: config.title.split("—")[0].trim(),
                    familyColor: FAMILY_META[config.family as FamilyKey]?.color ?? "#2563eb",
                    suspectedLabel: model.behavesLike,
                    score: selected.integrity_risk_score,
                    disposition: subject.synthesis.disposition,
                    recommended: subject.synthesis.recommended,
                    confidence: subject.synthesis.confidence,
                    href: `${config.route}/${model.key}`,
                    plane: "B",
                  }),
              }}
              footerNote={`${model.priority} · ${model.owner} · Decision-support only — a named human signs off.`}
            />
          );
        })() : null}
      </InvestigationDrawer>
    </div>
  );
}

// ---- investigation slide-over ---------------------------------------------
// A right-anchored drawer that overlays the console while the agent runs, so
// the evidence dossier underneath stays intact. Always mounted (so the panel
// slides in rather than pops), children mount only while open (so playback
// starts on open and stops on close).
function InvestigationDrawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  // Portal to <body>: this is a full-viewport overlay, and the page shell's
  // <main> carries a transform (animate-fade-up) + overflow-y-auto. Left in
  // place, `fixed` would resolve against that transformed ancestor and get
  // clipped by its scroll box. Portaling escapes both.
  return createPortal(
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 backdrop-blur-[1px] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(2,6,23,0.55)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI investigation"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon name="Building2" size={14} className="text-ink-3" />
          <span className="truncate text-[12px] font-semibold text-ink-2">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close investigation"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="X" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- evidence panel -------------------------------------------------------

function EvidencePanel({ merchant: m, model: c, config, stats, merchants, investigated, onInvestigate, disposition, onDispose }: {
  merchant: ExplorerMerchant; model: DetectionModel; config: TypologyConfig; stats: SignalStat[];
  merchants: ExplorerMerchant[]; investigated: boolean; onInvestigate: () => void;
  disposition: "cleared" | "confirmed" | null; onDispose: (d: "cleared" | "confirmed" | null) => void;
}) {
  const beyond = stats.filter((s) => s.z >= 3);
  const surcharge = config.family === "surcharge" ? assessSurcharge(m) : null;
  const synthesis = investigated ? subjectFromExplorer(m, c).synthesis : null;
  // Model-routed merchants carry score drivers → show the ML score decomposition
  // and drive the charts off those features. Rule-routed families keep the
  // fixed-signal lens and their rule-based flag basis.
  const isModel = (m.drivers?.length ?? 0) > 0;
  const pctx = isModel ? peerContext(merchants, m.mcc_group) : null;
  const declared = declaredDisplay(m, config);
  return (
    <Card className="p-0" glow={m.risk_tier === "Critical" ? "critical" : null}>
      {/* header */}
      <div className="flex flex-wrap items-start gap-3 border-b border-border p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
          <Icon name="Building2" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-bold">{m.merchant_name}</h2>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: TIER_HEX[m.risk_tier] }}>{m.risk_tier}</span>
            {disposition ? (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${disposition === "cleared" ? "bg-ok/15 text-ok" : "bg-critical/15 text-critical"}`}>
                <Icon name={disposition === "cleared" ? "Check" : "AlertTriangle"} size={10} />
                {disposition === "cleared" ? "Cleared" : "Confirmed"}
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs text-ink-3">{m.corp_name} · {m.merchant_city}, {m.merchant_country} · {m.merchant_id}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold tnum" style={{ color: TIER_HEX[m.risk_tier] }}>{m.integrity_risk_score.toFixed(1)}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-3">integrity risk</div>
          </div>
          {/* Primary action pinned to the dossier header — no scrolling to reach it. */}
          <Button variant="ai" onClick={onInvestigate} className="shrink-0">
            <Icon name="Sparkles" size={15} /> {investigated ? "Re-open" : "Investigate"}
          </Button>
        </div>
      </div>

      {/* pinned AI findings — the collapsed result of a completed investigation */}
      {synthesis ? <FindingsCard synthesis={synthesis} onReopen={onInvestigate} /> : null}

      {surcharge ? (
        <SurchargeCompliance a={surcharge} />
      ) : (
        <>
          {/* thesis */}
          <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-lg border border-border bg-surface-2/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-ink-3">Declared as</div>
              <div className="mt-1 text-sm font-semibold text-ink">{declared.group}</div>
              <div className="text-[11px] text-ink-3">MCC {m.declared_mcc} · {declared.kind}</div>
            </div>
            <Icon name="ArrowRight" size={18} className="mx-auto hidden text-ink-3 sm:block" />
            <div className="rounded-lg border p-3" style={{ borderColor: `${PRIORITY_HEX[c.priority]}44`, background: `${PRIORITY_HEX[c.priority]}0d` }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: PRIORITY_HEX[c.priority] }}>Behaves like ({c.priority})</div>
              <div className="mt-1 text-sm font-semibold text-ink">{c.short}</div>
              <div className="text-[11px] text-ink-3">{c.behavesLike}</div>
            </div>
          </div>

          {/* ML score decomposition — model-routed merchants only */}
          {isModel ? <ModelDecomposition m={m} stats={stats} /> : null}

          {/* peer-deviation charts — axes are this merchant's model drivers when
              model-routed, else the fixed per-typology signal lens */}
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between">
              <SectionLabel>{isModel ? "How these features deviate from declared-MCC peers" : "Deviation from declared-MCC peers"}</SectionLabel>
              <span className="text-[10px] text-ink-3">observed vs μ ± 3σ of legit {m.mcc_group}</span>
            </div>

            <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,300px)_1fr] lg:items-center">
              <DeviationRadar stats={stats} model={c} />
              <div className="space-y-2">
                {stats.map((st) => (
                  <DeviationBar key={String(st.sig.key)} stat={st} />
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-2">
              <Icon name={beyond.length ? "AlertTriangle" : "ShieldCheck"} size={13} className={beyond.length ? "text-critical" : "text-ok"} />
              {beyond.length ? (
                <span><b className="text-critical">{beyond.length}</b> feature{beyond.length === 1 ? "" : "s"} beyond 3σ of the {m.mcc_group} norm: {beyond.map((s) => s.sig.label).join(", ")}.</span>
              ) : (
                <span>No single feature exceeds 3σ — the flag is composite across {stats.length} variables.</span>
              )}
            </div>

            <PeerDistribution stats={stats} group={m.mcc_group} />

            {/* confidence band — honest about the peer baseline behind the z-scores */}
            {pctx ? (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-ink-3">
                <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
                <span>
                  Confidence: deviations measured vs{" "}
                  {pctx.source === "clean-group"
                    ? <><b className="text-ink-2">{pctx.n}</b> clean {m.mcc_group} peers</>
                    : pctx.source === "group"
                    ? <><b className="text-ink-2">{pctx.n}</b> {m.mcc_group} merchants</>
                    : <><b className="text-ink-2">{fmtNumber(pctx.n)}</b> clean merchants (global baseline — declared vertical has too few peers)</>}
                  . Synthetic data — directional, not a determination.
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* analyst triage — resolve the model's flag before it can leave the queue */}
      {!surcharge ? <TriageBar disposition={disposition} onDispose={onDispose} /> : null}

      {/* basis + exposure */}
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">Flag basis</div>
          <div className="mt-1 text-[13px] font-medium capitalize text-ink">{m.flag_reason}</div>
          {m.rule_names && m.rule_names !== "None" ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.rule_names.split(/\s*[,;|]\s*/).filter(Boolean).map((r) => (
                <span key={r} className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">{r}</span>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-ink-3">Model-driven — no deterministic rule fired.</div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Exposure" value={fmtCompact(m.gross_sales_usd)} />
          <MiniStat label="Txns" value={fmtNumber(m.txn_count)} />
          <MiniStat label="Cards" value={fmtNumber(m.unique_cards)} />
        </div>
      </div>

      {/* footer note — the primary Investigate action lives in the header above */}
      <div className="border-t border-border p-4 text-[11px] text-ink-3">
        Route to <b className="text-ink-2">{c.owner}</b> for {c.subtype} attestation — or run the full agent workup with <b className="text-ink-2">Investigate</b> in the header.
      </div>
    </Card>
  );
}

// ---- ML score decomposition -----------------------------------------------
// Replaces a "why this fired" rule list. The score IS the model output
// (100·P(abuse) from a logistic model over peer-relative feature z-scores); this
// card decomposes that single number into each feature's log-odds contribution,
// so the analyst sees which features drove the score and by how much.
const DRIVER_HEX = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#d97706", "#0d9488"];

function ModelDecomposition({ m, stats }: { m: ExplorerMerchant; stats: SignalStat[] }) {
  const p = m.integrity_risk_score / 100;
  const drivers = stats.filter((s) => (s.share ?? 0) > 0);
  if (!drivers.length) return null;
  return (
    <div className="px-4 pb-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Why the model scored it — feature attribution</SectionLabel>
        <span className="text-[10px] text-ink-3 tnum">P(abuse) {p.toFixed(3)} → {m.integrity_risk_score.toFixed(1)}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
        Identification is model-driven, not a rule checklist. The bar shows each feature's share of the
        model's push toward <span className="text-ink-2">abuse</span>.
      </p>

      {/* stacked contribution bar */}
      <div className="mt-2 flex h-6 overflow-hidden rounded-md border border-border">
        {drivers.map((st, i) => (
          <div
            key={String(st.sig.key)}
            className="h-full"
            style={{ width: `${(st.share ?? 0) * 100}%`, background: DRIVER_HEX[i % DRIVER_HEX.length] }}
            title={`${st.sig.label} — ${Math.round((st.share ?? 0) * 100)}%`}
          />
        ))}
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[440px] text-[12px]">
          <thead>
            <tr className="bg-surface-2/60 text-[10px] uppercase tracking-wide text-ink-3">
              <th className="px-3 py-1.5 text-left font-medium">Feature</th>
              <th className="px-3 py-1.5 text-right font-medium">This merchant</th>
              <th className="px-3 py-1.5 text-right font-medium">Peer norm</th>
              <th className="px-3 py-1.5 text-right font-medium">Deviation</th>
              <th className="px-3 py-1.5 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((st, i) => {
              const tone = zTone(st.z);
              return (
                <tr key={String(st.sig.key)} className="border-t border-border/60">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2 font-medium text-ink-2">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: DRIVER_HEX[i % DRIVER_HEX.length] }} />
                      {st.sig.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-ink tnum">{formatSignal(st.sig, st.observed)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-3 tnum">{formatSignal(st.sig, st.mean)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold tnum ${tone.text}`}>{fmtSigma(st.z)}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-ink tnum">{Math.round((st.share ?? 0) * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- analyst triage --------------------------------------------------------
// The model's flag is decision-support: an analyst confirms (escalate) or clears
// (false positive) it. Kept neutral — no ground-truth reveal; the decomposition
// and confidence band above are the evidence the analyst weighs.
function TriageBar({ disposition, onDispose }: {
  disposition: "cleared" | "confirmed" | null; onDispose: (d: "cleared" | "confirmed" | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
      <SectionLabel>Analyst triage</SectionLabel>
      <div className="ml-auto flex items-center gap-2">
        {disposition ? (
          <button
            onClick={() => onDispose(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            <Icon name="RotateCcw" size={13} /> Reset
          </button>
        ) : null}
        <button
          onClick={() => onDispose(disposition === "cleared" ? null : "cleared")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            disposition === "cleared" ? "border-ok bg-ok/15 text-ok" : "border-border bg-surface-2 text-ink-2 hover:text-ink"
          }`}
        >
          <Icon name="Check" size={14} /> Clear — false positive
        </button>
        <button
          onClick={() => onDispose(disposition === "confirmed" ? null : "confirmed")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-colors ${
            disposition === "confirmed" ? "bg-critical" : "bg-critical/85 hover:bg-critical"
          }`}
        >
          <Icon name="AlertTriangle" size={14} /> Confirm — escalate
        </button>
      </div>
    </div>
  );
}

// ---- pinned AI findings ---------------------------------------------------
// The durable summary a completed investigation leaves in the dossier: verdict,
// confidence, recommended disposition, and a way back into the full run. Shown
// on any merchant the analyst has already investigated in this session.
function FindingsCard({ synthesis, onReopen }: { synthesis: InvestigationSynthesis; onReopen: () => void }) {
  const conf = synthesis.confidence != null ? Math.round(synthesis.confidence * 100) : null;
  return (
    <div className="mx-4 mt-4 overflow-hidden rounded-xl border border-violet/30 bg-gradient-to-br from-violet/[0.07] to-cyan/[0.04]">
      <div className="flex items-center gap-2 border-b border-violet/20 px-3.5 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-cyan text-white">
          <Icon name="Sparkles" size={13} />
        </span>
        <span className="text-[12px] font-bold text-ink">AI investigation — findings</span>
        {conf != null ? (
          <span className="ml-auto rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-semibold text-ok tnum">
            {conf}%{synthesis.confidenceLabel ? ` · ${synthesis.confidenceLabel}` : ""}
          </span>
        ) : null}
      </div>
      <div className="px-3.5 py-3">
        <p className="text-[12px] leading-relaxed text-ink-2"><b className="text-ink">{synthesis.hypothesis}</b></p>
        {synthesis.recommended ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-surface/70 px-2.5 py-1.5 text-[11.5px]">
            <Icon name="Target" size={12} className="mt-0.5 shrink-0 text-cyan" />
            <span className="text-ink-2"><b className="text-ink">Recommended:</b> {synthesis.recommended}</span>
          </div>
        ) : null}
        <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-border bg-surface/70 px-2.5 py-1.5 text-[11.5px]">
          <Icon name="Briefcase" size={12} className="mt-0.5 shrink-0 text-amber" />
          <span className="text-ink-2"><b className="text-ink">Disposition:</b> {synthesis.disposition}</span>
        </div>
        <button onClick={onReopen} className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ai hover:underline">
          <Icon name="Sparkles" size={12} /> Reopen full investigation
        </button>
      </div>
    </div>
  );
}

// ---- surcharge portfolio (fee-integrity family only) ----------------------
// The whole-book NCA recovery lens: every surcharging merchant run through the
// same jurisdiction/cap/prohibited-card engine, rolled up to acquirer, violation
// type and jurisdiction, with the recovery band = violating × an editable
// $/merchant assessment. Hybrid of the two signed-off mockups (acquirer scorecard
// + regime matrix) sharing one merchant drill-down. Acquirers are synthetic
// (the book has no acquirer field); rate & volume are the real synthetic columns.

const SURCH_ACCENT = "#059669"; // fee-integrity family color (emerald)

function PortfolioBar({ pct, hex }: { pct: number; hex: string }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: hex }} />
    </div>
  );
}

function SevChip({ severity }: { severity: "SEVERE" | "POTENTIAL" }) {
  const sev = severity === "SEVERE";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold ${sev ? "bg-critical/12 text-critical" : "bg-amber/12 text-amber"}`}>
      {severity}
    </span>
  );
}

function SurchargePortfolioPanel({ merchants }: { merchants: ExplorerMerchant[] }) {
  const [ncaLow, setNcaLow] = useState(5000);
  const [ncaHigh, setNcaHigh] = useState(10000);
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<{ kind: "acq" | "vt" | "jur"; value: string } | null>(null);

  const p = useMemo(
    () => buildSurchargePortfolio(merchants, ncaLow, ncaHigh),
    [merchants, ncaLow, ncaHigh],
  );

  const rows = useMemo(() => {
    if (!filter) return p.merchants;
    if (filter.kind === "acq") return p.merchants.filter((m) => m.acquirer === filter.value);
    if (filter.kind === "vt") return p.merchants.filter((m) => m.vt === filter.value);
    return p.merchants.filter((m) => m.region === filter.value);
  }, [p, filter]);
  const shown = filter ? rows : rows.slice(0, 12);

  const maxAcqPv = Math.max(1, ...p.byAcquirer.map((a) => a.pv));
  const totVtPv = Math.max(1, p.byViolation.reduce((s, v) => s + v.pv, 0));
  const maxJurPv = Math.max(1, ...p.byJurisdiction.map((j) => j.pv));
  const money = (n: number) => fmtCurrency(n, true);
  const toggle = (kind: "acq" | "vt" | "jur", value: string) =>
    setFilter((f) => (f && f.kind === kind && f.value === value ? null : { kind, value }));

  return (
    <Card className="mt-4 overflow-hidden p-0" glow="cyan">
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${SURCH_ACCENT}14`, color: SURCH_ACCENT }}>
            <Icon name="Landmark" size={16} />
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: SURCH_ACCENT }}>Fee-integrity · portfolio scan</div>
            <div className="text-[13.5px] font-semibold text-ink">Acquirer NCA recovery — surcharge non-compliance at book scale</div>
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink">
          <Icon name="ChevronDown" size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border p-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border p-3" style={{ borderColor: `${SURCH_ACCENT}55`, background: `linear-gradient(135deg, ${SURCH_ACCENT}12, transparent)` }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">NCA recovery opportunity</div>
              <div className="mt-0.5 text-[22px] font-extrabold tnum" style={{ color: SURCH_ACCENT }}>{money(p.kpi.ncaLow)}–{money(p.kpi.ncaHigh)}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">{fmtNumber(p.kpi.violating)} violating × ${fmtNumber(ncaLow / 1000)}–{fmtNumber(ncaHigh / 1000)}K</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Violating merchants</div>
              <div className="mt-0.5 text-[22px] font-extrabold text-ink tnum">{fmtNumber(p.kpi.violating)}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">of {fmtNumber(p.kpi.surcharging)} surcharging · {Math.round((p.kpi.violating / Math.max(1, p.kpi.surcharging)) * 100)}% of book</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">PV in violation</div>
              <div className="mt-0.5 text-[22px] font-extrabold text-ink tnum">{money(p.kpi.pv)}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">surcharged volume under a failing regime</div>
            </div>
            <div className="rounded-xl border border-border p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Severity split</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-critical/12 px-2 py-0.5 text-[11px] font-bold text-critical tnum">{p.kpi.severe} severe</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber/12 px-2 py-0.5 text-[11px] font-bold text-amber tnum">{p.kpi.potential} potential</span>
              </div>
              <div className="mt-1 text-[11px] text-ink-3">severe = ban regime or prohibited card</div>
            </div>
          </div>

          {/* two lenses */}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {/* acquirer leaderboard */}
            <div className="rounded-xl border border-border p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Acquirers by recovery opportunity</SectionLabel>
                <span className="text-[10px] uppercase tracking-wide text-ink-3">click to filter</span>
              </div>
              <div className="space-y-2.5">
                {p.byAcquirer.map((a) => {
                  const active = filter?.kind === "acq" && filter.value === a.acquirer;
                  return (
                    <button key={a.acquirer} onClick={() => toggle("acq", a.acquirer)} className={`block w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${active ? "border-cyan/60 bg-cyan/[0.04]" : "border-transparent hover:bg-surface-2"}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">{a.acquirer}</span>
                        <span className="text-[13px] font-extrabold text-ink tnum">{money(a.n * ncaLow)}–{money(a.n * ncaHigh)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-3">
                        <span>{a.n} violating · <span className="text-critical">{a.severe} severe</span> · {money(a.pv)} PV</span>
                      </div>
                      <PortfolioBar pct={(a.pv / maxAcqPv) * 100} hex={SURCH_ACCENT} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* violation type + jurisdiction */}
            <div className="rounded-xl border border-border p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Violation type · jurisdiction</SectionLabel>
                <span className="text-[10px] uppercase tracking-wide text-ink-3">click to filter</span>
              </div>
              <div className="space-y-2">
                {p.byViolation.map((v) => {
                  const hex = violationHex(v.vt);
                  const active = filter?.kind === "vt" && filter.value === v.vt;
                  return (
                    <button key={v.vt} onClick={() => toggle("vt", v.vt)} className={`block w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${active ? "border-cyan/60 bg-cyan/[0.04]" : "border-border hover:bg-surface-2"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                          <span className="h-2 w-2 rounded-full" style={{ background: hex }} /> {v.vt}
                          <SevChip severity={v.severity} />
                        </span>
                        <span className="text-[14px] font-extrabold text-ink tnum">{fmtNumber(v.n)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
                        <span>{money(v.pv)} PV · {Math.round((v.pv / totVtPv) * 100)}% of violation PV</span>
                      </div>
                      <PortfolioBar pct={(v.pv / totVtPv) * 100} hex={hex} />
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-border pt-2.5">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">By jurisdiction</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.byJurisdiction.map((j) => {
                    const active = filter?.kind === "jur" && filter.value === j.region;
                    return (
                      <button key={j.region} onClick={() => toggle("jur", j.region)} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${active ? "border-cyan/60 bg-cyan/[0.06] text-ink" : "border-border text-ink-2 hover:bg-surface-2"}`}>
                        {j.region} <span className="text-ink-3 tnum">{j.n}</span>
                        <span className="text-ink-3">·</span>
                        <span className="text-ink-3 tnum">{money(j.pv)}</span>
                        <span className="ml-0.5 h-1 w-6 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full rounded-full" style={{ width: `${Math.max(6, (j.pv / maxJurPv) * 100)}%`, background: SURCH_ACCENT }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* NCA math + editable rate */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed p-3" style={{ borderColor: `${SURCH_ACCENT}66` }}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Recovery math</span>
            <span className="inline-flex items-center gap-2 text-[13px]">
              <span className="rounded-md border border-border bg-surface px-2 py-1 font-bold text-ink tnum">{fmtNumber(p.kpi.violating)}</span>
              <span className="text-[11px] text-ink-3">violating</span>
              <span className="font-bold text-ink-3">×</span>
              <label className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-bold text-ink">
                $<input type="number" min={0} step={500} value={ncaLow} onChange={(e) => setNcaLow(Math.max(0, Number(e.target.value) || 0))} className="w-16 bg-transparent text-[13px] font-bold text-ink outline-none tnum" aria-label="NCA low rate per merchant" />
              </label>
              <span className="text-ink-3">–</span>
              <label className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-bold text-ink">
                $<input type="number" min={0} step={500} value={ncaHigh} onChange={(e) => setNcaHigh(Math.max(0, Number(e.target.value) || 0))} className="w-20 bg-transparent text-[13px] font-bold text-ink outline-none tnum" aria-label="NCA high rate per merchant" />
              </label>
              <span className="text-[11px] text-ink-3">/ merchant</span>
              <span className="font-bold text-ink-3">=</span>
              <span className="rounded-md px-2.5 py-1 font-extrabold text-white tnum" style={{ background: SURCH_ACCENT }}>{money(p.kpi.ncaLow)}–{money(p.kpi.ncaHigh)}</span>
            </span>
            <span className="flex items-start gap-1.5 text-[11px] text-ink-3">
              <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
              Per-merchant assessment band is a demo assumption — edit to reprice the opportunity.
            </span>
          </div>

          {/* drill-down */}
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>Violating merchants{filter ? "" : " — top by PV"}</SectionLabel>
              {filter ? (
                <button onClick={() => setFilter(null)} className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-cyan">
                  {filter.value} <Icon name="X" size={11} />
                </button>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead>
                  <tr className="bg-surface-2/60 text-left text-[10px] uppercase tracking-wide text-ink-3">
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium">Jurisdiction</th>
                    <th className="px-3 py-2 font-medium">Violation</th>
                    <th className="px-3 py-2 font-medium">Acquirer</th>
                    <th className="px-3 py-2 text-right font-medium">Surcharge</th>
                    <th className="px-3 py-2 text-right font-medium">PV in violation</th>
                    <th className="px-3 py-2 text-right font-medium">NCA</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id} className="border-t border-border hover:bg-surface-2/50">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{m.name}</div>
                        <div className="text-[10.5px] text-ink-3 tnum">{m.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-ink-2">{m.region}</div>
                        <div className="text-[10.5px] text-ink-3">{m.city}, {m.country}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: violationHex(m.vt) }} />
                          <span className="text-ink-2">{m.vt}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-3">{m.acquirer}</td>
                      <td className="px-3 py-2 text-right text-ink-2 tnum">
                        {m.surchargePct.toFixed(1)}%
                        <div className="text-[10.5px] text-ink-3">on {Math.round(m.pctSurcharged * 100)}%</div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-ink tnum">{fmtCurrency(m.pv)}</td>
                      <td className="px-3 py-2 text-right text-ink-2 tnum">${fmtNumber(ncaLow / 1000)}–{fmtNumber(ncaHigh / 1000)}K</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 text-[10.5px] text-ink-3">
              {filter ? `${shown.length} merchant${shown.length === 1 ? "" : "s"} · ${filter.value}` : `Showing top 12 of ${fmtNumber(p.merchants.length)}`}
              {" · "}Acquirers are deterministic synthetic (the book carries no acquirer field); jurisdiction, rate & volume are real synthetic columns. Directional decision-support, not a compliance determination.
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// ---- surcharge compliance (fee-integrity family only) ---------------------
// Replaces the peer-deviation lens with the analyst's rule-based read: a verdict
// (status + primary violation category + statutory basis), the risk & compliance
// matrix, transaction/web evidence, and a 2–3 step action plan. All figures are
// deterministic synthetic — directional decision-support, not ground truth.

const STATUS_ICON: Record<SurchargeAssessment["status"], string> = {
  COMPLIANT: "ShieldCheck",
  "POTENTIAL VIOLATION": "AlertTriangle",
  "SEVERE VIOLATION": "ShieldAlert",
  "INSUFFICIENT DATA": "Info",
};

function StatusPill({ status }: { status: "pass" | "fail" | "info" }) {
  if (status === "info") return <span className="text-[11px] text-ink-3">—</span>;
  const fail = status === "fail";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${fail ? "bg-critical/15 text-critical" : "bg-ok/15 text-ok"}`}>
      <Icon name={fail ? "X" : "Check"} size={10} /> {fail ? "FAIL" : "PASS"}
    </span>
  );
}

function SurchargeCompliance({ a }: { a: SurchargeAssessment }) {
  const regimeLabel =
    a.jurisdiction.regime === "ban" ? "Ban jurisdiction"
    : a.jurisdiction.regime === "capped" ? "Capped jurisdiction"
    : "Cost-of-acceptance";
  return (
    <div className="space-y-4 p-4">
      {/* verdict */}
      <div className="rounded-xl border p-3" style={{ borderColor: `${a.statusHex}55`, background: `${a.statusHex}0d` }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: a.statusHex }}>
            <Icon name={STATUS_ICON[a.status]} size={13} /> {a.status}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: a.statusHex }}>{regimeLabel} · {a.jurisdiction.region}</span>
        </div>
        <div className="mt-1.5 text-sm font-semibold text-ink">{a.primaryViolation}</div>
        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-ink-3">
          <Icon name="Scale" size={12} className="mt-0.5 shrink-0" /> {a.jurisdiction.basis}
        </div>
      </div>

      {/* risk & compliance matrix */}
      <div>
        <SectionLabel>Risk &amp; compliance matrix</SectionLabel>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[440px] text-[12px]">
            <thead>
              <tr className="bg-surface-2/60 text-left text-[10px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 font-medium">Parameter</th>
                <th className="px-3 py-2 font-medium">Detected value</th>
                <th className="px-3 py-2 font-medium">Statutory limit</th>
                <th className="px-3 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {a.matrix.map((r) => (
                <tr key={r.param} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-medium text-ink-2"><Icon name={r.icon} size={13} className="text-ink-3" /> {r.param}</span>
                  </td>
                  <td className="px-3 py-2 text-ink">{r.detected}</td>
                  <td className="px-3 py-2 text-ink-3">{r.allowed}</td>
                  <td className="px-3 py-2 text-center"><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* evidence breakdown */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3"><Icon name="Table2" size={12} /> Transaction-data analysis</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{a.transactionNote}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3"><Icon name="Globe" size={12} /> Web-intelligence insight</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{a.webNote}</p>
        </div>
      </div>

      {/* action plan */}
      <div>
        <SectionLabel>Investigative action plan</SectionLabel>
        <ol className="mt-2 space-y-1.5">
          {a.actions.map((act, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-ink-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-[9px] font-bold text-cyan tnum">{i + 1}</span>
              {act}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// Inline KPI read-out for the compact control toolbar — value over a micro-label,
// so the whole cohort summary rides on the toolbar's right edge in one row.
function Kpi({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className={`text-[15px] font-bold tnum ${tone}`}>{value}</span>
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
    </div>
  );
}

// Removable active-filter pill shown next to "Filters" when the facets are
// collapsed — one-click clear so a hidden filter is never silently in effect.
function ActiveChip({ children, onClear, dot }: { children: ReactNode; onClear: () => void; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cyan/35 bg-cyan/15 px-2 py-0.5 text-[10px] font-medium text-cyan">
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> : null}
      {children}
      <button onClick={onClear} aria-label="Remove filter" className="opacity-70 hover:opacity-100"><Icon name="X" size={9} /></button>
    </span>
  );
}

function FilterChip({ children, active, onClick, dot }: {
  children: ReactNode; active?: boolean; onClick: () => void; dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "border-cyan/50 bg-cyan/15 text-cyan"
          : "border-border bg-surface-2 text-ink-2 hover:border-ink-3 hover:text-ink"
      }`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> : null}
      {children}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-sm font-bold tnum">{value}</div>
    </div>
  );
}

// ---- deviation visualizations ---------------------------------------------

// Radar plotted in σ-space (not raw units). The centre is the declared-MCC peer
// average; the amber ring is the 3σ envelope; the rose shape is how far this
// merchant pushes past it per axis. Radius uses saturating sigmaPos() so wildly
// different z-scores stay legible and distinct.
function DeviationRadar({ stats, model }: { stats: SignalStat[]; model: DetectionModel }) {
  const data = stats.map((st) => ({
    axis: st.sig.label,
    observed: sigmaPos(st.z) * 100,
    band: THREE_SIGMA_POS * 100,
    _stat: st,
  }));
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={CHART.grid} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: CHART.axis }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar name="3σ envelope" dataKey="band" stroke={CHART.amber} fill={CHART.amber} fillOpacity={0.06} strokeDasharray="4 3" />
          <Radar name={model.short} dataKey="observed" stroke={CHART.rose} fill={CHART.rose} fillOpacity={0.28} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          <Tooltip content={<RadarTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadarTooltip({ active, payload }: { active?: boolean; payload?: { payload?: { axis: string; _stat: SignalStat } }[] }) {
  if (!active || !payload || !payload.length) return null;
  const st = payload[0]?.payload?._stat;
  if (!st) return null;
  const tone = zTone(st.z);
  return (
    <div className="rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-card backdrop-blur-sm">
      <div className="mb-1 font-semibold text-ink">{st.sig.label}</div>
      <div className="flex items-center justify-between gap-4 tnum"><span className="text-ink-3">Observed</span><span className="font-semibold text-ink">{formatSignal(st.sig, st.observed)}</span></div>
      <div className="flex items-center justify-between gap-4 tnum"><span className="text-ink-3">Peer μ</span><span className="text-ink-2">{formatSignal(st.sig, st.mean)}</span></div>
      <div className="flex items-center justify-between gap-4 tnum"><span className="text-ink-3">Deviation</span><span className={`font-semibold ${tone.text}`}>{fmtSigma(st.z)}</span></div>
      <div className="flex items-center justify-between gap-4 tnum"><span className="text-ink-3">Percentile</span><span className="text-ink-2">{fmtPercentile(st.pct)}</span></div>
    </div>
  );
}

// Horizontal deviation bar in σ-space: the track's left edge is the peer mean,
// the shaded zone is the 3σ normal envelope, and the coloured fill shows how far
// past it this merchant sits (saturating scale, so extreme bars stay distinct).
function DeviationBar({ stat: st }: { stat: SignalStat }) {
  const tone = zTone(st.z);
  const obsPos = sigmaPos(st.z) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 truncate text-[12px] text-ink-2">{st.sig.label}</div>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 bg-ink-3/10" style={{ width: `${THREE_SIGMA_POS * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-amber/70" style={{ left: `${THREE_SIGMA_POS * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, obsPos)}%`, background: tone.hex, opacity: 0.85 }} />
      </div>
      <div className="flex w-24 shrink-0 items-center justify-end gap-1.5 tnum">
        <span className={`text-[12px] font-semibold ${tone.text}`}>{formatSignal(st.sig, st.observed)}</span>
        <span className={`rounded px-1 py-px text-[9px] font-bold ${tone.text}`} style={{ background: `${tone.hex}18` }}>
          {fmtSigma(st.z)}
        </span>
      </div>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function fmtPercentile(p: number): string {
  const v = p * 100;
  if (v >= 99.95) return "99.9th+";
  if (v >= 99) return `${v.toFixed(1)}th`; // fractional — always "th"
  const r = Math.round(v);
  return `${r}${ordinalSuffix(r)}`;
}

// The actual peer distribution for the single most-deviant signal: "here's the
// herd, here's how far outside it this merchant sits."
// One dot per legitimate peer, stacked where they pile up (a Wilkinson dot plot).
// For prohibited-behaviour signals the peers collapse into a tight cluster near
// zero and this merchant sits far out on its own — the empty span between them is
// the whole point, so we shade it as an explicit "gap no compliant peer reaches"
// instead of leaving a blank histogram that reads as broken.
function PeerDistribution({ stats, group }: { stats: SignalStat[]; group: string }) {
  const st = stats.reduce((a, b) => (b.z > a.z ? b : a), stats[0]);
  if (!st || st.sample.length < 4) return null;

  const BINS = 48;
  const CAP = 7; // max dots drawn per column; the rest show as a "+N" tag
  const DOT = 9; // px between stacked dots
  const hi = Math.max(st.observed, ...st.sample) * 1.06 || 1;
  const toPct = (v: number) => Math.max(0, Math.min(100, (v / hi) * 100));

  const level = new Array(BINS).fill(0);
  const dots: { x: number; lvl: number }[] = [];
  const sorted = [...st.sample].sort((a, b) => a - b);
  for (const v of sorted) {
    const b = Math.max(0, Math.min(BINS - 1, Math.floor((v / hi) * BINS)));
    const lvl = level[b]++;
    if (lvl < CAP) dots.push({ x: toPct((b + 0.5) * (hi / BINS)), lvl });
  }
  const overflow: { x: number; n: number }[] = [];
  level.forEach((n, b) => { if (n > CAP) overflow.push({ x: toPct((b + 0.5) * (hi / BINS)), n: n - CAP }); });

  const meanPct = toPct(st.mean);
  const ceilPct = toPct(st.ceiling);
  const obsPct = toPct(st.observed);
  const peerMaxPct = toPct(Math.max(...st.sample));
  const showGap = obsPct - peerMaxPct > 6;

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-ink-2">Peer distribution · <span className="text-ink-3">{st.sig.label}</span></div>
        <span className="text-[10px] text-ink-3">{st.sample.length} legit {group} merchants</span>
      </div>

      <div className="relative mt-6 h-24">
        {/* gap between the peer herd and this merchant */}
        {showGap ? (
          <div
            className="absolute inset-y-0 border-x border-dashed border-high/25 bg-high/[0.035]"
            style={{ left: `${peerMaxPct}%`, width: `${obsPct - peerMaxPct}%` }}
          >
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[9px] font-medium text-high/70">
              no compliant peer reaches here
            </span>
          </div>
        ) : null}

        {/* μ and 3σ reference lines */}
        <div className="absolute inset-y-0 w-px bg-ink-3/50" style={{ left: `${meanPct}%` }}>
          <span className="absolute -top-4 left-1 whitespace-nowrap text-[9px] text-ink-3">μ {formatSignal(st.sig, st.mean)}</span>
        </div>
        <div className="absolute inset-y-0 w-px bg-amber/60" style={{ left: `${ceilPct}%` }}>
          <span className="absolute -top-4 left-1 whitespace-nowrap text-[9px] font-semibold text-amber">3σ</span>
        </div>

        {/* peer dots */}
        {dots.map((d, i) => (
          <span
            key={i}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-ink-3/50"
            style={{ left: `${d.x}%`, bottom: `${4 + d.lvl * DOT}px` }}
          />
        ))}
        {overflow.map((o, i) => (
          <span
            key={`o${i}`}
            className="absolute -translate-x-1/2 text-[9px] font-semibold text-ink-3"
            style={{ left: `${o.x}%`, bottom: `${6 + CAP * DOT}px` }}
          >
            +{o.n}
          </span>
        ))}

        {/* this merchant */}
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-high" style={{ left: `${obsPct}%` }}>
          <div className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-high ring-2 ring-surface" />
        </div>
      </div>

      {/* axis endpoints */}
      <div className="mt-1 flex justify-between border-t border-border pt-1 text-[9px] text-ink-3 tnum">
        <span>{formatSignal(st.sig, 0)}</span>
        <span>{formatSignal(st.sig, hi)}</span>
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-[10.5px] text-ink-2">
        <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-high" />
        <span>
          Legit {group} peers cluster at μ <b>{formatSignal(st.sig, st.mean)}</b>; this merchant reports{" "}
          <b className="text-critical">{formatSignal(st.sig, st.observed)}</b> — beyond the{" "}
          <b>{fmtPercentile(st.pct)}</b> percentile of the herd.
        </span>
      </div>
    </div>
  );
}
