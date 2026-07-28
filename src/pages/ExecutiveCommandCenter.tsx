import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { CHART, ChartTooltip } from "@/components/charts/kit";
import { fmtCurrency, fmtCompact, fmtNumber, fmtPct } from "@/utils/format";
import { exportJson } from "@/utils/exports";
import { useAppStore } from "@/stores/appStore";
import type { FiledCase } from "@/types/domain";
import {
  overview, FAMILY_META, TIER_ORDER, TIER_HEX, PRIORITY_TIER_HEX,
  type Family, type OverviewTier, type PriorityMerchant,
} from "@/data/overview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? MONTHS[m - 1] : iso;
}

/** Stacked severity bar — encodes each family's tier mix as proportion, not number. */
function SeverityBar({ counts }: { counts: Record<OverviewTier, number> }) {
  const total = TIER_ORDER.reduce((s, t) => s + (counts[t] || 0), 0);
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-2" />;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
      {TIER_ORDER.map((t) =>
        counts[t] ? (
          <span
            key={t}
            title={`${t}: ${counts[t]}`}
            style={{ width: `${(counts[t] / total) * 100}%`, background: TIER_HEX[t] }}
          />
        ) : null,
      )}
    </div>
  );
}

function FamilyCard({ fam, onOpen }: { fam: Family; onOpen: () => void }) {
  const meta = FAMILY_META[fam.key];
  return (
    <button
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-card-hover"
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: meta.color }} />
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: `${meta.color}14`, color: meta.color }}
        >
          <Icon name={meta.icon} size={16} />
        </span>
        <span className="text-[13.5px] font-semibold tracking-tight text-ink">{fam.label}</span>
        {fam.separateClass ? (
          <span className="ml-auto rounded-full border border-violet/30 bg-violet/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-violet">
            Separate class
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[28px] font-bold leading-none tracking-tight tnum">{fmtNumber(fam.alerts)}</span>
        <span className="text-[11px] font-medium text-ink-3">alerts</span>
        <span className="ml-auto text-right text-[15px] font-bold tracking-tight tnum">
          {fmtCurrency(fam.exposure, true)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-3 tnum">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_HEX.Critical }} />
          {fam.critical} critical
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_HEX.High }} />
          {fam.high} high
        </span>
      </div>

      <div className="mt-3">
        <SeverityBar counts={fam.tierCounts} />
      </div>

      <p className="mt-3 text-[11.5px] leading-snug text-ink-3">{meta.blurb}</p>

      <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-ink-2 opacity-0 transition group-hover:opacity-100">
        Open module <Icon name="ChevronRight" size={13} />
      </div>
    </button>
  );
}

/** Per-family model-cohort taxonomy — each row is one detection model's remediation
 *  queue; clicking deep-links into that model on the family's console. */
function FamilyTaxonomy({ fam, onOpenModel }: { fam: Family; onOpenModel: (key: string) => void }) {
  const meta = FAMILY_META[fam.key];
  const subs = fam.subtypes ?? [];
  const maxAlerts = Math.max(1, ...subs.map((s) => s.alerts));
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-2/40 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${meta.color}14`, color: meta.color }}>
          <Icon name={meta.icon} size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{fam.label}</div>
          <div className="text-[10.5px] text-ink-3 tnum">
            {fmtNumber(fam.alerts)} flagged · {fmtCurrency(fam.exposure, true)} exposure
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {(fam.priorityTiers ?? []).map((pt) => (
            <span
              key={pt.tier}
              title={pt.label}
              className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white tnum"
              style={{ background: PRIORITY_TIER_HEX[pt.tier] }}
            >
              {pt.tier} {pt.alerts}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 p-2">
        {subs.map((st) => (
          <button
            key={st.key}
            onClick={() => onOpenModel(st.key)}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2/60"
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-ink">{st.label}</div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(st.alerts / maxAlerts) * 100}%`, background: meta.color }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="rounded px-1 py-0.5 text-[9px] font-bold text-white"
                style={{ background: st.tier === "—" ? "#94a3b8" : PRIORITY_TIER_HEX[st.tier as "P1"] }}
              >
                {st.tier}
              </span>
              <span className="w-6 text-right text-[12.5px] font-bold tnum">{st.alerts}</span>
              <span className="hidden w-14 text-right text-[11px] text-ink-3 tnum sm:block">
                {fmtCurrency(st.exposure, true)}
              </span>
              <Icon name="ChevronRight" size={13} className="text-ink-3" />
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** The cross-tab write-back: cases the analyst filed from AI investigations land
 *  here, linking the investigation desk to the executive view. Starts empty and
 *  grows live as the user works — the "what changed" delta. */
function FiledCasesPanel({ cases, onClear, onOpen }: {
  cases: FiledCase[]; onClear: () => void; onOpen: (href: string) => void;
}) {
  const now = Date.now();
  const fams = new Map<string, { color: string; n: number }>();
  for (const c of cases) {
    const e = fams.get(c.familyLabel) ?? { color: c.familyColor, n: 0 };
    e.n += 1;
    fams.set(c.familyLabel, e);
  }

  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Cases you filed · from the investigation desk</SectionLabel>
        {cases.length > 0 ? (
          <button onClick={onClear} className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink-2">
            <Icon name="X" size={12} /> Clear
          </button>
        ) : null}
      </div>

      {cases.length === 0 ? (
        <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-surface-2/30 px-4 py-3 text-[11.5px] text-ink-3">
          <Icon name="Briefcase" size={15} className="shrink-0 text-ink-3" />
          <span>Run an AI investigation and hit <b className="text-ink-2">File to case queue</b> — the outcome lands here, connecting the analyst's desk to this executive view.</span>
        </div>
      ) : (
        <Card className="mt-2 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/40 px-4 py-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan/10 px-2.5 py-0.5 text-[11px] font-bold text-cyan">
              <Icon name="Sparkles" size={12} /> {cases.length} filed this session
            </span>
            {[...fams.entries()].map(([label, e]) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} /> {label} {e.n}
              </span>
            ))}
          </div>
          <div>
            {cases.slice(0, 5).map((c, i) => (
              <button
                key={c.id}
                onClick={() => onOpen(c.href)}
                className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-soft px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-2/60"
              >
                <span className="grid h-8 w-8 place-items-center rounded-[9px] text-[13px] font-bold text-white tnum" style={{ background: c.familyColor }}>
                  {Math.round(c.score)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{c.merchantName}</span>
                    {i === 0 ? <span className="shrink-0 rounded-full bg-cyan/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-cyan">New</span> : null}
                  </div>
                  <div className="truncate text-[11px] text-ink-3">
                    behaves like {c.suspectedLabel} · <span className="text-ink-2">{c.disposition}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-right text-[10.5px] text-ink-3 sm:block">{timeAgo(c.filedAt, now)}</span>
                  <Icon name="ChevronRight" size={14} className="text-ink-3" />
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

export default function ExecutiveCommandCenter() {
  const navigate = useNavigate();
  const { portfolio, detection, families, priority, trend, meta } = overview;
  const filedCases = useAppStore((s) => s.filedCases);
  const clearFiledCases = useAppStore((s) => s.clearFiledCases);

  const tierData = overview.tiers;
  const totalAlerts = families.reduce((s, f) => s + f.alerts, 0);

  return (
    <div>
      <PageHeader
        icon="LayoutDashboard"
        title="Integrity Intelligence Command Center"
        subtitle="Portfolio-wide merchant-integrity risk across six alert families · synthetic monitoring window"
        actions={
          <>
            <Button variant="ghost" onClick={() => exportJson("integrity-overview.json", overview)}>
              <Icon name="Download" size={15} /> Export summary
            </Button>
            <Button variant="primary" onClick={() => navigate("/explorer?view=risk")}>
              <Icon name="Orbit" size={15} /> Merchant book
            </Button>
          </>
        }
      />

      <FiledCasesPanel cases={filedCases} onClear={clearFiledCases} onOpen={(href) => navigate(href)} />

      {/* ══════════ Headline coverage + trend ══════════ */}
      <section>
        <SectionLabel>Portfolio at a glance</SectionLabel>
        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_1.35fr]">
          <Card className="grid grid-cols-2 overflow-hidden">
            {[
              {
                l: "Merchants monitored",
                v: fmtNumber(portfolio.merchantsMonitored),
                d: `${fmtCompact(portfolio.transactionsScored)} transactions scored`,
              },
              {
                l: "Flagged for review",
                v: fmtNumber(portfolio.flaggedMerchants),
                d: `${fmtNumber(portfolio.criticalMerchants)} critical · ${totalAlerts} alerts`,
              },
              {
                l: "Flagged exposure",
                v: fmtCurrency(portfolio.flaggedExposureUsd, true),
                d: `${fmtPct(portfolio.flaggedExposurePct)} of ${fmtCurrency(portfolio.grossSalesUsd, true)} book`,
              },
              {
                l: "Detection quality",
                v: detection ? `${fmtPct(detection.precision)} · ${fmtNumber(detection.alertVolume)}` : "—",
                d: "precision · alerts vs. labels",
              },
            ].map((s, i) => (
              <div
                key={s.l}
                className={`border-border p-4 ${i % 2 === 1 ? "border-l" : ""} ${i > 1 ? "border-t" : ""}`}
              >
                <SectionLabel>{s.l}</SectionLabel>
                <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight tnum">{s.v}</div>
                <div className="mt-1.5 text-[11px] text-ink-3 tnum">{s.d}</div>
              </div>
            ))}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <SectionLabel>Settled volume · total vs. flagged</SectionLabel>
              <div className="flex items-center gap-3 text-[10.5px] font-semibold text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: CHART.cyan }} /> Total
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: CHART.rose }} /> Flagged
                </span>
              </div>
            </div>
            <div className="mt-3 h-[168px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ left: -14, right: 6, top: 4 }}>
                  <defs>
                    <linearGradient id="gVol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.cyan} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART.cyan} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gFlag" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.rose} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={CHART.rose} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={monthLabel} minTickGap={16} />
                  <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => fmtCompact(v)} width={44} />
                  <Tooltip
                    content={<ChartTooltip fmt={(v) => fmtCurrency(v, true)} />}
                    labelFormatter={(l) => monthLabel(String(l))}
                  />
                  <Area name="Total volume" type="monotone" dataKey="volume" stroke={CHART.cyan} fill="url(#gVol)" strokeWidth={2} />
                  <Area name="Flagged volume" type="monotone" dataKey="flaggedVolume" stroke={CHART.rose} fill="url(#gFlag)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </section>

      {/* ══════════ Six alert families ══════════ */}
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Alert families · one primary typology per merchant</SectionLabel>
          <span className="text-[11px] text-ink-3">
            Exposure attributed to a single family — never double-counted across typologies.
          </span>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {families.map((f) => (
            <FamilyCard key={f.key} fam={f} onOpen={() => navigate(FAMILY_META[f.key].route)} />
          ))}
        </div>
      </section>

      {/* ══════════ Per-family model cohorts (remediation queues) ══════════ */}
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Model cohorts by family · remediation queues</SectionLabel>
          <span className="text-[11px] text-ink-3">
            Each row is one detection model — merchants behaving like the category but declared benign. Open to work the cohort.
          </span>
        </div>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {families
            .filter((f) => (f.subtypes?.length ?? 0) > 0)
            .map((f) => (
              <FamilyTaxonomy
                key={f.key}
                fam={f}
                onOpenModel={(key) => navigate(`${FAMILY_META[f.key].route}/${key}`)}
              />
            ))}
        </div>
      </section>

      {/* ══════════ Detection quality + tier distribution ══════════ */}
      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <SectionLabel>Detection quality · measured against synthetic labels</SectionLabel>
          <Card className="mt-2 p-4">
            {detection ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: "Precision", v: fmtPct(detection.precision), c: CHART.cyan },
                    { l: "Captured exposure", v: fmtCurrency(detection.capturedExposureUsd, true), c: CHART.green },
                    { l: "Alert volume", v: fmtNumber(detection.alertVolume), c: CHART.axis },
                    { l: "False positives", v: fmtNumber(detection.fp), c: CHART.amber },
                  ].map((m) => (
                    <div key={m.l} className="rounded-lg border border-border bg-surface-2/40 p-3">
                      <SectionLabel>{m.l}</SectionLabel>
                      <div className="mt-1 text-[22px] font-bold leading-none tracking-tight tnum" style={{ color: m.c }}>
                        {m.v}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-3">
                  <div className="flex items-center justify-between border-b border-border-soft pb-1.5">
                    <span className="text-ink-3">Integrity violations</span>
                    <span className="font-bold tnum">{fmtNumber(detection.integrityViolations)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border-soft pb-1.5">
                    <span className="text-ink-3">Interchange abuse</span>
                    <span className="font-bold tnum">{fmtNumber(detection.interchangeAbuse)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border-soft pb-1.5">
                    <span className="text-ink-3">Missed (FN)</span>
                    <span className="font-bold tnum">{fmtNumber(detection.fn)}</span>
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-2 text-[11px] leading-snug text-ink-2">
                  <Icon name="Info" size={14} className="mt-0.5 shrink-0 text-cyan" />
                  <span>{meta.note}</span>
                </p>
              </>
            ) : (
              <div className="py-8 text-center text-sm text-ink-3">No labelled evaluation available.</div>
            )}
          </Card>
        </div>

        <div>
          <SectionLabel>Portfolio risk tiers</SectionLabel>
          <Card className="mt-2 p-4">
            <div className="flex items-center gap-4">
              <div className="h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tierData} dataKey="count" nameKey="tier" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                      {tierData.map((d) => (
                        <Cell key={d.tier} fill={TIER_HEX[d.tier]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip fmt={(v) => fmtNumber(v)} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {tierData.map((d) => (
                  <div key={d.tier} className="flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 rounded-full" style={{ background: TIER_HEX[d.tier] }} />
                    <span className="text-ink-2">{d.tier}</span>
                    <span className="ml-auto font-bold tnum">{fmtNumber(d.count)}</span>
                    <span className="w-14 text-right text-ink-3 tnum">{fmtCurrency(d.exposure, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* ══════════ Priority merchant queue ══════════ */}
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Priority merchant queue · top exposure-weighted risk</SectionLabel>
          <span className="text-[11px] text-ink-3">Ranked by exposure × integrity risk score</span>
        </div>
        <Card className="mt-2 overflow-hidden">
          <div className="hidden grid-cols-[48px_minmax(0,1fr)_170px_150px_110px] items-center gap-3 border-b border-border bg-surface-2 px-4 py-2.5 lg:grid">
            <SectionLabel>Score</SectionLabel>
            <SectionLabel>Merchant</SectionLabel>
            <SectionLabel>Family</SectionLabel>
            <SectionLabel>Declared MCC</SectionLabel>
            <SectionLabel className="text-right">Exposure</SectionLabel>
          </div>
          {priority.map((m: PriorityMerchant) => {
            const fmeta = FAMILY_META[m.family];
            return (
              <button
                key={m.id}
                onClick={() => navigate(fmeta.route)}
                className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-soft px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-2/60 lg:grid-cols-[48px_minmax(0,1fr)_170px_150px_110px]"
              >
                <span
                  className="grid h-9 w-9 place-items-center rounded-[10px] text-[14px] font-bold text-white tnum"
                  style={{ background: TIER_HEX[m.tier] }}
                >
                  {Math.round(m.score)}
                </span>

                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">
                    {m.name}
                    <span className="ml-1.5 font-mono text-[10.5px] font-medium text-ink-3">{m.id}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-3">
                    {[m.city, m.country].filter(Boolean).join(", ")}
                    {m.subtype ? <span className="text-ink-2"> · {m.subtype}</span> : null}
                  </div>
                </div>

                <div className="hidden items-center gap-1.5 lg:flex">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: fmeta.color }} />
                  <span className="text-[11.5px] font-semibold text-ink-2">{m.familyLabel}</span>
                </div>

                <div className="hidden min-w-0 lg:block">
                  <div className="font-mono text-[12px] font-semibold text-ink">{m.declaredMcc}</div>
                  <div className="truncate text-[10.5px] text-ink-3">{m.mccGroup}</div>
                </div>

                <div className="text-right text-[13.5px] font-bold tracking-tight tnum">
                  {fmtCurrency(m.exposure, true)}
                </div>
              </button>
            );
          })}
        </Card>
      </section>
    </div>
  );
}
