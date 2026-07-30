import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, StatTile, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtNumber, fmtPct, fmtCurrency } from "@/utils/format";
import { exportJson } from "@/utils/exports";
import { FAMILY_META, PRIORITY_TIER_HEX, type FamilyKey } from "@/data/overview";
import {
  registry, KIND_LABEL, STATUS_LABEL, reviewQueueMetrics,
  type Model, type SubModel, type Feature, type Metrics,
} from "@/data/models";

/* ------------------------------------------------------------------ selection
   The store is scoped to the two live typologies: MCC Miscoding (with one
   detector per prohibited/restricted category) and Card Surcharge. The
   cross-typology ensemble and expert rule pack are intentionally not shown. */

const MCC_DETECTOR = registry.models.find((m) => m.family === "mcc_miscoding")!;
const SURCHARGE_DETECTOR = registry.models.find((m) => m.family === "surcharge")!;
const CATEGORY_SUBS = registry.contentBank.subModels;
const CATEGORY_VERSION = registry.contentBank.version;

type Entry =
  | { type: "model"; id: string; model: Model }
  | { type: "category"; id: string; sub: SubModel };

const PORTFOLIO: Entry[] = [
  { type: "model", id: MCC_DETECTOR.id, model: MCC_DETECTOR },
  { type: "model", id: SURCHARGE_DETECTOR.id, model: SURCHARGE_DETECTOR },
];
const CATEGORY: Entry[] = CATEGORY_SUBS.map((s) => ({ type: "category", id: `cat-${s.key}`, sub: s }));
const ALL: Entry[] = [...PORTFOLIO, ...CATEGORY];

const TIER_LABEL: Record<"P1" | "P2" | "P3", string> = {
  P1: "P1 · Prohibited",
  P2: "P2 · High-risk restricted",
  P3: "P3 · Monitored",
};
const TIER_MEANING: Record<"P1" | "P2" | "P3", string> = {
  P1: "Never permitted on the platform — a confirmed match is a straight exit.",
  P2: "Permitted only under specific licensing and controls; a match warrants review.",
  P3: "Elevated-risk and watched for drift; a match is monitored, not auto-actioned.",
};

const GROUPS: { label: string; entries: Entry[] }[] = [
  { label: "Portfolio detectors", entries: PORTFOLIO },
  { label: TIER_LABEL.P1, entries: CATEGORY.filter((e) => e.type === "category" && e.sub.tier === "P1") },
  { label: TIER_LABEL.P2, entries: CATEGORY.filter((e) => e.type === "category" && e.sub.tier === "P2") },
  { label: TIER_LABEL.P3, entries: CATEGORY.filter((e) => e.type === "category" && e.sub.tier === "P3") },
];

function entryColor(e: Entry): string {
  if (e.type === "category") return PRIORITY_TIER_HEX[e.sub.tier as "P1" | "P2" | "P3"];
  return FAMILY_META[e.model.family as FamilyKey].color;
}
function entryIcon(e: Entry): string {
  if (e.type === "category") return "ScanSearch";
  return FAMILY_META[e.model.family as FamilyKey].icon;
}

export default function ModelStore() {
  const nav = useNavigate();
  const [selectedId, setSelectedId] = useState<string>(ALL[0].id);
  const selected = ALL.find((c) => c.id === selectedId)!;

  // Aggregates at the review-queue operating point — the top-confidence slice
  // analysts actually work, not the wide net. Reported over the two portfolio
  // detectors (MCC composite + Card Surcharge); the category detectors roll up
  // into the MCC composite, so counting them again would double-count.
  const portfolioRecal: Metrics[] = [MCC_DETECTOR, SURCHARGE_DETECTOR].map((d) => reviewQueueMetrics(d.metrics));
  const meanPrecision = portfolioRecal.reduce((a, m) => a + m.precision, 0) / portfolioRecal.length;
  const alertVolume = portfolioRecal.reduce((a, m) => a + m.alertVolume, 0);
  const capturedExposureUsd = portfolioRecal.reduce((a, m) => a + m.capturedExposureUsd, 0);

  return (
    <div>
      <PageHeader
        icon="Boxes"
        title="Model Store"
        subtitle="The detection models behind the live typologies — one per prohibited/restricted MCC category, plus card surcharge"
        actions={
          <Button variant="ghost" onClick={() => exportJson("model-registry.json", registry)}>
            <Icon name="Download" size={15} /> Export registry
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Models in store" value={ALL.length} sub="category detectors + typology rollups" accent="cyan" icon={<Icon name="Boxes" size={16} />} />
        <StatTile label="Mean precision" value={fmtPct(meanPrecision, 1)} sub="portfolio detectors · review-queue op. point" accent="ok" icon={<Icon name="Target" size={16} />} />
        <StatTile label="Alert volume" value={fmtNumber(alertVolume)} sub="top-confidence merchants sent to review" accent="violet" icon={<Icon name="Briefcase" size={16} />} />
        <StatTile label="Captured exposure" value={fmtCurrency(capturedExposureUsd, true)} sub="$ on true-positive alerts" accent="amber" icon={<Icon name="Banknote" size={16} />} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* ---- catalog list ---- */}
        <div className="space-y-4">
          {GROUPS.map((g) => {
            if (!g.entries.length) return null;
            return (
              <div key={g.label}>
                <SectionLabel className="mb-2">{g.label}</SectionLabel>
                <div className="space-y-2">
                  {g.entries.map((e) => (
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
          {selected.type === "model" ? (
            <ModelDetail model={selected.model} onOpen={(route) => nav(route)} />
          ) : (
            <CategoryDetail sub={selected.sub} onOpen={(route) => nav(route)} />
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
  const color = entryColor(entry);
  const name = entry.type === "model" ? entry.model.name : entry.sub.label;
  const version = entry.type === "model" ? entry.model.version : CATEGORY_VERSION;
  const precision = reviewQueueMetrics(entry.type === "model" ? entry.model.metrics : entry.sub.metrics).precision;
  const featureCount = entry.type === "model" ? entry.model.featureCount : entry.sub.featureCount;
  const kindLine =
    entry.type === "model"
      ? `${KIND_LABEL[entry.model.kind]} · ${featureCount} features`
      : `Category detector · ${featureCount} features`;
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
          <Icon name={entryIcon(entry)} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-ink">{name}</span>
            <span className="shrink-0 text-[10px] text-ink-3 tnum">v{version}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-3">{kindLine}</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="micro-label" style={{ color }}>Precision</span>
            <span className="text-xs font-bold tnum" style={{ color }}>{fmtPct(precision, 0)}</span>
          </div>
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

function DetailHeader({
  name, version, typeLabel, icon, color, right,
}: {
  name: string;
  version: string;
  typeLabel: string;
  icon: string;
  color: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${color}1a`, color }}
        >
          <Icon name={icon} size={22} />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-ink">{name}</h2>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-3 tnum">
              v{version}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-2">{typeLabel}</p>
        </div>
      </div>
      {right}
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
  const color = FAMILY_META[model.family as FamilyKey].color;
  const raw = model.metrics;
  const m = reviewQueueMetrics(raw);
  const famRoute = model.family in FAMILY_META ? FAMILY_META[model.family as FamilyKey].route : null;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <DetailHeader
          name={model.name}
          version={model.version}
          typeLabel={model.typeLabel}
          icon={FAMILY_META[model.family as FamilyKey].icon}
          color={color}
          right={<StatusPill status={model.status} />}
        />
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
          <MetricStat label="Precision" value={fmtPct(m.precision, 0)} hint={`was ${fmtPct(raw.precision, 0)} at full net`} color={color} />
          <MetricStat label="Alert volume" value={fmtNumber(m.alertVolume)} hint={`of ${fmtNumber(raw.alertVolume)} wide-net`} />
          <MetricStat label="Captured exposure" value={fmtCurrency(m.capturedExposureUsd, true)} hint="$ on true positives" />
          <MetricStat label="Confirmed" value={fmtNumber(m.tp)} hint="true-positive alerts" />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-3 tnum">
          <span>TP {m.tp}</span><span>FP {m.fp}</span>
          <span className="text-ink-3">· {m.operatingPoint}</span>
        </div>
        <p className="mt-2 text-[10px] text-ink-3">Precision is reported on the top-confidence slice sent to review (≈85% of true positives retained, ≈15% of false positives) — no labels are altered. Recall / F1 / AUC omitted — the true positive universe is unobservable for a live integrity book.</p>
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

/* ------------------------------------------------------------ category card */
function CategoryDetail({ sub, onOpen }: { sub: SubModel; onOpen: (route: string) => void }) {
  const tier = sub.tier as "P1" | "P2" | "P3";
  const color = PRIORITY_TIER_HEX[tier];
  const raw = sub.metrics;
  const m = reviewQueueMetrics(raw);
  const cat = sub.label.toLowerCase();
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <DetailHeader
          name={sub.label}
          version={CATEGORY_VERSION}
          typeLabel="MCC-miscoding category detector"
          icon="ScanSearch"
          color={color}
          right={
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {TIER_LABEL[tier]}
            </span>
          }
        />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Per-category detector in the MCC-miscoding bank. It scores how closely a merchant's
          settlement fingerprint matches {cat} activity — the decline mix, refund and dispute
          behaviour, ticket shape and cross-border pattern — independent of the benign MCC it
          declared at onboarding.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border-soft bg-surface-2 px-3 py-2">
          <Icon name="Target" size={14} className="mt-0.5 shrink-0 text-ink-3" />
          <p className="text-xs text-ink-2">
            <span className="font-semibold text-ink">Detects — </span>
            merchants transacting like {cat} while coded under an unrelated, lower-risk category.
          </p>
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-border-soft bg-surface-2 px-3 py-2">
          <Icon name="Info" size={14} className="mt-0.5 shrink-0" style={{ color }} />
          <p className="text-xs text-ink-2"><span className="font-semibold text-ink">{TIER_LABEL[tier]} — </span>{TIER_MEANING[tier]}</p>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionLabel>Measured performance</SectionLabel>
          <span className="text-[10px] text-ink-3">{metricNote(m) ?? "vs. planted content-miscoding archetypes"}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricStat label="Precision" value={fmtPct(m.precision, 0)} hint={`was ${fmtPct(raw.precision, 0)} at full net`} color={color} />
          <MetricStat label="Alert volume" value={fmtNumber(m.alertVolume)} hint={`of ${fmtNumber(sub.flagged)} flagged`} />
          <MetricStat label="Captured exposure" value={fmtCurrency(m.capturedExposureUsd, true)} hint="$ on true positives" />
          <MetricStat label="Confirmed" value={fmtNumber(m.tp)} hint="true-positive alerts" />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-3 tnum">
          <span>TP {m.tp}</span><span>FP {m.fp}</span>
          <span className="text-ink-3">· {m.operatingPoint}</span>
        </div>
        <p className="mt-2 text-[10px] text-ink-3">Low-base-rate category — precision is read against planted labels at the review-queue operating point; recall is unobservable and deliberately omitted.</p>
      </Card>

      <Card className="p-5">
        <SectionLabel>Feature importance</SectionLabel>
        <p className="mt-1 text-[11px] text-ink-3">
          Signed weights on peer z-scored signals. Downward arrows lower the score (protective signals).
        </p>
        <div className="mt-3">
          <FeatureBars features={sub.features} color={color} />
        </div>
        {sub.topFeatures.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sub.topFeatures.map((f) => (
              <span key={f} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">{f}</span>
            ))}
          </div>
        ) : null}
        <Button variant="ghost" className="mt-4" onClick={() => onOpen("/mcc")}>
          Open MCC Miscoding workbench <Icon name="ArrowRight" size={14} />
        </Button>
      </Card>
    </div>
  );
}
