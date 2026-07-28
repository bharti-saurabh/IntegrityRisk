import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  type CategorySignal,
} from "@/data/miscodingCategories";
import type { TypologyConfig, DetectionModel } from "@/data/typologies";
import { TIER_HEX, TIER_ORDER, FAMILY_META, type OverviewTier, type FamilyKey } from "@/data/overview";
import { subjectFromExplorer, buildInvestigation } from "@/features/ai-copilot/agentStream";
import { AgentStreamPanel } from "@/features/ai-copilot/AgentStreamPanel";
import { useAppStore } from "@/stores/appStore";

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
  const [mode, setMode] = useState<"evidence" | "agent">("evidence");
  const [runId, setRunId] = useState(0);
  // Local queue filters — how an analyst narrows the remediation list to what
  // they'll actually work. Kept out of the global store so they can't perturb
  // other consoles or the portfolio view.
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<OverviewTier | "all">("all");
  const [minSignals, setMinSignals] = useState(0);
  const [hideCased, setHideCased] = useState(false);
  const [sortBy, setSortBy] = useState<"risk" | "exposure" | "signals">("risk");

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
    setMode("evidence");
    setQuery("");
    setTierFilter("all");
    setMinSignals(0);
    setHideCased(false);
    setSortBy("risk");
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
  const resetFilters = () => { setQuery(""); setTierFilter("all"); setMinSignals(0); setHideCased(false); };

  const stats = useMemo(
    () => (merchants && selected ? computeStats(merchants, selected, model) : []),
    [merchants, selected, model],
  );

  if (error) return <EmptyState title="Couldn't load merchant data" hint={error} />;
  if (!merchants) return <EmptyState title="Loading detection models…" hint="Scoring the synthetic portfolio across the typology catalog." />;

  const startAgent = () => { setMode("agent"); setRunId((n) => n + 1); };

  return (
    <div>
      <PageHeader icon={config.icon} title={config.title} subtitle={config.subtitle} />

      {/* ---- Control: model selector + cohort metrics in one compact band -- */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:gap-4">
          <div className="min-w-[260px] flex-1">
            <SectionLabel>Identification model</SectionLabel>
            <div className="relative mt-1.5">
              <select
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-surface-2 py-2.5 pl-3 pr-9 text-sm font-semibold text-ink outline-none focus:border-cyan/50"
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
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel>Priority</SectionLabel>
            <span
              className="inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold"
              style={{ color: PRIORITY_HEX[model.priority], borderColor: `${PRIORITY_HEX[model.priority]}55`, background: `${PRIORITY_HEX[model.priority]}12` }}
            >
              {model.priority} · {PRIORITY_LABEL[model.priority]}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel>Remediation owner</SectionLabel>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2">
              <Icon name="Users" size={13} /> {model.owner}
            </span>
          </div>
        </div>

        <div className="border-t border-border bg-cyan/[0.03] px-4 py-2.5 text-[13px] text-ink-2">
          <span className="font-semibold text-ink-3">Model output — </span>
          <b className="text-ink">{cohort.length}</b> merchant{cohort.length === 1 ? "" : "s"} {config.behaveVerb}{" "}
          <b className="text-ink">{model.behavesLike}</b> but are declared under {config.declaredKind}. Signals:{" "}
          {model.signals.map((s) => s.label).join(" · ")}.
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricCell label="Cohort size" value={fmtNumber(cohort.length)} sub={`suspected & ${config.cohortSuffix}`} tone="text-cyan" icon="Layers" />
          <MetricCell label="Exposure at stake" value={fmtCompact(summary.exposure)} sub="gross sales in cohort" tone="text-amber" icon="TrendingUp" />
          <MetricCell label="Avg integrity risk" value={summary.avg.toFixed(1)} sub="0–100 model score" tone="text-critical" icon="Gauge" />
          <MetricCell label="Critical / High" value={fmtNumber(summary.acute)} sub={`${summary.modelFlagged} model-flagged`} tone="text-violet" icon="ShieldAlert" />
        </div>
      </Card>

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

          {/* Queue filters — narrow the list to what you'll actually work. */}
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

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <button
                onClick={() => setHideCased((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-2 hover:text-ink"
              >
                <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${hideCased ? "border-cyan bg-cyan text-white" : "border-border bg-surface-2"}`}>
                  {hideCased ? <Icon name="Check" size={10} /> : null}
                </span>
                Hide filed cases
              </button>
              {filtersActive ? (
                <button onClick={resetFilters} className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
                  <Icon name="X" size={11} /> Clear
                </button>
              ) : null}
            </div>
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
                    onClick={() => { setSelectedId(m.merchant_id); setMode("evidence"); }}
                    className={`flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left transition-all ${active ? "bg-cyan/[0.06]" : "hover:bg-surface-2/60"}`}
                  >
                    <TierDot tier={m.risk_tier} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-ink">{m.merchant_name}</span>
                        {cased ? <Icon name="Check" size={12} className="shrink-0 text-ok" /> : null}
                      </div>
                      <div className="truncate text-[11px] text-ink-3">declared {m.declared_mcc} · {m.mcc_group}</div>
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
          ) : mode === "agent" ? (
            (() => {
              const subject = subjectFromExplorer(selected, model);
              return (
                <div className="space-y-3">
                  <Button variant="ghost" onClick={() => setMode("evidence")}>
                    <Icon name="ArrowLeft" size={15} /> Back to evidence
                  </Button>
                  <AgentStreamPanel
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
                </div>
              );
            })()
          ) : (
            <EvidencePanel merchant={selected} model={model} config={config} stats={stats} onInvestigate={startAgent} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- evidence panel -------------------------------------------------------

function EvidencePanel({ merchant: m, model: c, config, stats, onInvestigate }: {
  merchant: ExplorerMerchant; model: DetectionModel; config: TypologyConfig; stats: SignalStat[]; onInvestigate: () => void;
}) {
  const beyond = stats.filter((s) => s.z >= 3);
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
          </div>
          <div className="truncate text-xs text-ink-3">{m.corp_name} · {m.merchant_city}, {m.merchant_country} · {m.merchant_id}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tnum" style={{ color: TIER_HEX[m.risk_tier] }}>{m.integrity_risk_score.toFixed(1)}</div>
          <div className="text-[10px] uppercase tracking-wide text-ink-3">integrity risk</div>
        </div>
      </div>

      {/* thesis */}
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-3">Declared as</div>
          <div className="mt-1 text-sm font-semibold text-ink">{m.mcc_group}</div>
          <div className="text-[11px] text-ink-3">MCC {m.declared_mcc} · {config.declaredKind}</div>
        </div>
        <Icon name="ArrowRight" size={18} className="mx-auto hidden text-ink-3 sm:block" />
        <div className="rounded-lg border p-3" style={{ borderColor: `${PRIORITY_HEX[c.priority]}44`, background: `${PRIORITY_HEX[c.priority]}0d` }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: PRIORITY_HEX[c.priority] }}>Behaves like ({c.priority})</div>
          <div className="mt-1 text-sm font-semibold text-ink">{c.short}</div>
          <div className="text-[11px] text-ink-3">{c.behavesLike}</div>
        </div>
      </div>

      {/* deviation from declared-MCC peers */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Deviation from declared-MCC peers</SectionLabel>
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
            <span><b className="text-critical">{beyond.length}</b> signal{beyond.length === 1 ? "" : "s"} beyond 3σ of the {m.mcc_group} norm: {beyond.map((s) => s.sig.label).join(", ")}.</span>
          ) : (
            <span>No single signal exceeds 3σ — the flag is composite across {stats.length} variables.</span>
          )}
        </div>

        <PeerDistribution stats={stats} group={m.mcc_group} />
      </div>

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

      {/* CTA */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
        <div className="text-[11px] text-ink-3">
          Route to <b className="text-ink-2">{c.owner}</b> for {c.subtype} attestation.
        </div>
        <Button variant="ai" onClick={onInvestigate}>
          <Icon name="Sparkles" size={15} /> Investigate with AI
        </Button>
      </div>
    </Card>
  );
}

// Dense metric cell for the control-card summary strip — hairline-separated,
// far tighter than a full StatTile so the whole cohort read-out costs one row.
function MetricCell({ label, value, sub, tone, icon }: {
  label: string; value: string; sub: string; tone: string; icon: string;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="micro-label">{label}</span>
        <Icon name={icon} size={15} className={`opacity-60 ${tone}`} />
      </div>
      <div className={`mt-1 text-2xl font-bold tnum ${tone}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-ink-3 tnum">{sub}</div>
    </div>
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

function fmtPercentile(p: number): string {
  const v = p * 100;
  if (v >= 99.95) return "99.9th+";
  return `${v.toFixed(v >= 99 ? 1 : 0)}th`;
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
