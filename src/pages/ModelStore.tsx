import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, StatTile, Button, Chip } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtNumber, fmtPct, fmtCurrency } from "@/utils/format";
import { exportJson } from "@/utils/exports";
import { FAMILY_META, PRIORITY_TIER_HEX, type FamilyKey } from "@/data/overview";
import {
  registry, KIND_LABEL, STATUS_LABEL, AUX_COLOR,
  type Model, type ContentBank, type RulePack, type Feature, type Metrics,
} from "@/data/models";

type Entry = Model | ContentBank | RulePack;

const CARDS: Entry[] = [
  ...registry.models.filter((m) => m.kind === "method-detector"),
  registry.models.find((m) => m.kind === "ensemble")!,
  registry.contentBank,
  registry.rulePack,
];

function accentOf(e: Entry): string {
  if (e.kind === "ensemble") return AUX_COLOR.ensemble;
  if (e.kind === "expert-rules") return AUX_COLOR.rules;
  return FAMILY_META[e.family as FamilyKey].color;
}
function iconOf(e: Entry): string {
  if (e.kind === "ensemble") return "Network";
  if (e.kind === "expert-rules") return "Filter";
  if (e.kind === "content-classifier") return "Layers";
  return FAMILY_META[e.family as FamilyKey].icon;
}

const GROUPS: { label: string; kinds: Entry["kind"][] }[] = [
  { label: "Typology detectors", kinds: ["method-detector"] },
  { label: "Portfolio ensemble", kinds: ["ensemble"] },
  { label: "Content bank & rules", kinds: ["content-classifier", "expert-rules"] },
];

export default function ModelStore() {
  const nav = useNavigate();
  const [selectedId, setSelectedId] = useState<string>(CARDS[0].id);
  const selected = CARDS.find((c) => c.id === selectedId)!;

  const precisionValues = registry.models
    .map((m) => m.metrics.precision)
    .filter((v): v is number => typeof v === "number");
  const meanPrecision = precisionValues.reduce((a, b) => a + b, 0) / Math.max(1, precisionValues.length);
  const capturedExposureUsd = registry.models.reduce((a, m) => a + (m.metrics.capturedExposureUsd ?? 0), 0);
  const alertVolume = registry.models.reduce((a, m) => a + (m.metrics.alertVolume ?? 0), 0);

  return (
    <div>
      <PageHeader
        icon="Boxes"
        title="Model Store"
        subtitle="The detection models behind every typology — features, calibration, and measured performance"
        actions={
          <Button variant="ghost" onClick={() => exportJson("model-registry.json", registry)}>
            <Icon name="Download" size={15} /> Export registry
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Models in store" value={CARDS.length} sub="detectors · ensemble · rules" accent="cyan" icon={<Icon name="Boxes" size={16} />} />
        <StatTile label="Mean precision" value={fmtPct(meanPrecision, 1)} sub="across detectors, at op. point" accent="ok" icon={<Icon name="Target" size={16} />} />
        <StatTile label="Alert volume" value={fmtNumber(alertVolume)} sub="merchants sent to review" accent="violet" icon={<Icon name="Briefcase" size={16} />} />
        <StatTile label="Captured exposure" value={fmtCurrency(capturedExposureUsd, true)} sub="$ on true-positive alerts" accent="amber" icon={<Icon name="Banknote" size={16} />} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* ---- catalog list ---- */}
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const items = CARDS.filter((c) => g.kinds.includes(c.kind));
            if (!items.length) return null;
            return (
              <div key={g.label}>
                <SectionLabel className="mb-2">{g.label}</SectionLabel>
                <div className="space-y-2">
                  {items.map((e) => (
                    <CatalogRow
                      key={e.id}
                      entry={e}
                      active={e.id === selectedId}
                      onClick={() => setSelectedId(e.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- detail ---- */}
        <div className="min-w-0">
          {selected.kind === "content-classifier" ? (
            <ContentBankDetail bank={selected as ContentBank} />
          ) : selected.kind === "expert-rules" ? (
            <RulePackDetail pack={selected as RulePack} onOpen={(route) => nav(route)} />
          ) : (
            <ModelDetail model={selected as Model} onOpen={(route) => nav(route)} />
          )}
        </div>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-ink-3">
        {registry.meta.note}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ catalog */
function CatalogRow({ entry, active, onClick }: { entry: Entry; active: boolean; onClick: () => void }) {
  const color = accentOf(entry);
  const precision = "metrics" in entry ? entry.metrics.precision : undefined;
  const headline =
    entry.kind === "expert-rules"
      ? `${(entry as RulePack).rules.length} gates`
      : entry.kind === "content-classifier"
        ? `${(entry as ContentBank).subModels.length} classifiers`
        : `${(entry as Model).featureCount} features`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border bg-surface p-3 text-left transition ${
        active ? "border-transparent shadow-card-hover ring-2" : "border-border hover:border-ink-3"
      }`}
      style={active ? ({ ["--tw-ring-color" as string]: color } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}1a`, color }}
        >
          <Icon name={iconOf(entry)} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-ink">{entry.name}</span>
            <span className="shrink-0 text-[10px] text-ink-3 tnum">v{entry.version}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-3">{KIND_LABEL[entry.kind]} · {headline}</div>
          {typeof precision === "number" ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="micro-label" style={{ color }}>Precision</span>
              <span className="text-xs font-bold tnum" style={{ color }}>{fmtPct(precision, 0)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ shared */
function StatusPill({ status }: { status: keyof typeof STATUS_LABEL }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] font-semibold text-ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function DetailHeader({ entry }: { entry: Entry }) {
  const color = accentOf(entry);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${color}1a`, color }}
        >
          <Icon name={iconOf(entry)} size={22} />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-ink">{entry.name}</h2>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3 tnum">
              v{entry.version}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-2">{entry.typeLabel}</p>
        </div>
      </div>
      <StatusPill status={entry.status} />
    </div>
  );
}

function MetricStat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border-soft bg-surface-2 px-3 py-2.5">
      <div className="micro-label">{label}</div>
      <div className="mt-1 text-xl font-bold tnum" style={color ? { color } : undefined}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-ink-3">{hint}</div> : null}
    </div>
  );
}

function FeatureBars({ features, color }: { features: Feature[]; color: string }) {
  const max = Math.max(...features.map((f) => f.importance), 1);
  return (
    <div className="space-y-2">
      {features.map((f) => {
        const down = f.direction === "down";
        const w = (f.importance / max) * 100;
        return (
          <div key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Icon
                  name={down ? "ArrowDownRight" : "ArrowUpRight"}
                  size={12}
                  className={down ? "text-ink-3" : ""}
                  style={down ? undefined : { color }}
                />
                <span className="truncate text-xs text-ink-2">{f.label}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${w}%`,
                    backgroundColor: down ? "#94a3b8" : color,
                    opacity: down ? 0.55 : 1,
                  }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold tnum text-ink">{f.importance.toFixed(0)}%</div>
              <div className="text-[10px] tnum text-ink-3">w {f.weight > 0 ? "+" : ""}{f.weight}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function metricNote(m: Metrics): string | undefined {
  return m.gtNote;
}

/* --------------------------------------------------------------- model card */
function ModelDetail({ model, onOpen }: { model: Model; onOpen: (route: string) => void }) {
  const color = accentOf(model);
  const m = model.metrics;
  const famRoute = model.family in FAMILY_META ? FAMILY_META[model.family as FamilyKey].route : null;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <DetailHeader entry={model} />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{model.summary}</p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border-soft bg-surface-2 px-3 py-2">
          <Icon name="Target" size={14} className="mt-0.5 shrink-0 text-ink-3" />
          <p className="text-xs text-ink-2"><span className="font-semibold text-ink">Detects — </span>{model.detects}</p>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionLabel>Measured performance</SectionLabel>
          <span className="text-[10px] text-ink-3">{metricNote(m)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricStat label="Precision" value={fmtPct(m.precision, 0)} hint="of alerts confirmed" color={color} />
          <MetricStat label="Alert volume" value={fmtNumber(m.alertVolume)} hint="merchants reviewed" />
          <MetricStat label="Captured exposure" value={fmtCurrency(m.capturedExposureUsd, true)} hint="$ on true positives" />
          <MetricStat label="Confirmed" value={fmtNumber(m.tp)} hint="true-positive alerts" />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-3 tnum">
          <span>TP {m.tp}</span><span>FP {m.fp}</span>
          <span className="text-ink-3">· operating point: {m.operatingPoint}</span>
        </div>
        <p className="mt-2 text-[10px] text-ink-3">Recall / F1 / AUC omitted — the true positive universe is unobservable for a live integrity book.</p>
      </Card>

      <Card className="p-5">
        <SectionLabel>Feature importance</SectionLabel>
        <p className="mt-1 text-[11px] text-ink-3">
          Signed weights on peer z-scored signals. Downward arrows lower the score (protective signals).
        </p>
        <div className="mt-3">
          <FeatureBars features={model.features} color={color} />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <SectionLabel>Calibration</SectionLabel>
          <dl className="mt-3 space-y-2 text-xs">
            <Row k="Link function" v={`${model.calibration.link} (k = ${model.calibration.k})`} />
            <Row k="Normalization" v={model.calibration.normalization} />
            <Row k="Output" v={<code className="rounded bg-surface-2 px-1 py-0.5 text-[11px] text-ink">{model.calibration.output}</code>} />
          </dl>
          {model.calibration.tiers ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {model.calibration.tiers.map((t) => (
                <span key={t.tier} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-2 tnum">
                  {t.tier} · {t.range}
                </span>
              ))}
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <SectionLabel>Paired rules</SectionLabel>
          {model.rules.length ? (
            <div className="mt-3 space-y-2">
              {model.rules.map((r) => (
                <div key={r.name} className="rounded-lg border border-border-soft bg-surface-2 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Icon name="Filter" size={12} className="text-ink-3" />
                    {r.name}
                  </div>
                  <code className="mt-1 block text-[11px] leading-relaxed text-ink-2">{r.expr}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-3">
              No hard rule paired — this model reaches the queue through the composite score.
            </p>
          )}
          {famRoute ? (
            <Button variant="ghost" className="mt-3" onClick={() => onOpen(famRoute)}>
              Open {model.name.replace(" Detector", "")} workbench <Icon name="ArrowRight" size={14} />
            </Button>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-ink-3">{k}</dt>
      <dd className="text-right text-ink-2">{v}</dd>
    </div>
  );
}

/* --------------------------------------------------------- content bank card */
function ContentBankDetail({ bank }: { bank: ContentBank }) {
  const color = FAMILY_META.mcc_miscoding.color;
  const [tab, setTab] = useState<"P1" | "P2" | "P3">("P1");
  const subs = bank.subModels.filter((s) => s.tier === tab);
  const tm = bank.tierMetrics;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <DetailHeader entry={bank} />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{bank.summary}</p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/5 px-3 py-2">
          <Icon name="Info" size={14} className="mt-0.5 shrink-0 text-amber" />
          <p className="text-[11px] leading-relaxed text-ink-2">{bank.note}</p>
        </div>
      </Card>

      <Card className="p-5">
        <SectionLabel>Priority-tier detection (audited)</SectionLabel>
        <p className="mt-1 text-[11px] text-ink-3">
          The reliable read: precision of the P1/P2/P3 rollup against planted labels, with the alert volume each tier raises.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["P1", "P2", "P3"] as const).map((t) => (
            <div key={t} className="rounded-lg border border-border-soft bg-surface-2 p-3">
              <span
                className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ backgroundColor: PRIORITY_TIER_HEX[t] }}
              >
                {t}
              </span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-xl font-bold tnum text-ink">{fmtPct(tm[t].precision, 0)}</span>
                <span className="text-[10px] text-ink-3">precision</span>
              </div>
              <div className="text-[10px] text-ink-3 tnum">{fmtNumber(tm[t].alertVolume)} alerts · {fmtNumber(tm[t].tp)} confirmed</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Content classifiers ({bank.subModels.length})</SectionLabel>
          <div className="flex gap-1.5">
            {(["P1", "P2", "P3"] as const).map((t) => (
              <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Chip>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {subs.map((s) => (
            <div key={s.key} className="rounded-lg border border-border-soft bg-surface px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: PRIORITY_TIER_HEX[tab] }}
                  />
                  <span className="text-sm font-semibold text-ink">{s.label}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] tnum text-ink-3">
                  <span>{s.featureCount} feats</span>
                  <span>{s.flagged} alerts</span>
                  <span className="font-bold" style={{ color }}>P {fmtPct(s.metrics.precision, 0)}</span>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.topFeatures.map((f) => (
                  <span key={f} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- rule pack card */
function RulePackDetail({ pack, onOpen }: { pack: RulePack; onOpen: (route: string) => void }) {
  const color = AUX_COLOR.rules;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <DetailHeader entry={pack} />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{pack.summary}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MetricStat label="Gates" value={String(pack.rules.length)} hint="deterministic" color={color} />
          <MetricStat label="Total firings" value={fmtNumber(pack.totalFired)} hint="across the book" />
          <MetricStat label="Route" value="OR" hint="model ∪ rules → queue" />
        </div>
      </Card>

      <Card className="p-5">
        <SectionLabel>Rule gates</SectionLabel>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead>
              <tr className="border-b border-border text-ink-3">
                <th className="pb-2 font-medium">Rule</th>
                <th className="pb-2 font-medium">Family</th>
                <th className="pb-2 font-medium">Condition</th>
                <th className="pb-2 text-right font-medium">Fired</th>
              </tr>
            </thead>
            <tbody>
              {pack.rules.map((r) => {
                const fam = r.family in FAMILY_META ? (r.family as FamilyKey) : null;
                const fcolor = fam ? FAMILY_META[fam].color : "#64748b";
                return (
                  <tr
                    key={r.name}
                    className="border-b border-border-soft last:border-0 hover:bg-surface-2"
                    onClick={() => fam && onOpen(FAMILY_META[fam].route)}
                    style={{ cursor: fam ? "pointer" : "default" }}
                  >
                    <td className="py-2 pr-3 font-semibold text-ink">{r.name}</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: fcolor }} />
                        <span className="text-ink-2">{r.family}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3"><code className="text-[11px] text-ink-2">{r.expr}</code></td>
                    <td className="py-2 text-right font-bold tnum text-ink">{fmtNumber(r.fired)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
