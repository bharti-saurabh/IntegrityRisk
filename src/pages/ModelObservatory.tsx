import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar, Cell, Area, ComposedChart,
} from "recharts";
import { useAppStore, metricsAtThreshold } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, StatTile, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { CHART, ChartTooltip } from "@/components/charts/kit";
import { fmtPct, fmtNumber, fmtCurrency } from "@/utils/format";
import { exportJson } from "@/utils/exports";

export default function ModelObservatory() {
  const result = useAppStore((s) => s.result)!;
  const threshold = useAppStore((s) => s.threshold);
  const metrics = useMemo(() => metricsAtThreshold(result, threshold)!, [result, threshold]);

  const curve = metrics.curve;
  const c = metrics.confusion;
  const total = c.tp + c.fp + c.tn + c.fn;

  return (
    <div>
      <PageHeader
        icon="Activity"
        title="Model Observatory"
        subtitle="Precision, alert workload & captured exposure against synthetic ground truth · threshold = current alert cut"
        actions={
          <Button variant="ghost" onClick={() => exportJson("model-metrics.json", metrics)}>
            <Icon name="Download" size={15} /> Export metrics
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Precision" value={fmtPct(metrics.precision, 1)} sub={`@ threshold ${threshold}`} accent="cyan" />
        <StatTile label="Alert volume" value={fmtNumber(metrics.alertVolume)} sub="merchants sent to review" accent="violet" />
        <StatTile label="Captured exposure" value={fmtCurrency(metrics.capturedExposureUsd, true)} sub="$ on true-positive alerts" accent="ok" />
        <StatTile label="True positives" value={fmtNumber(c.tp)} sub="confirmed abuse alerted" accent="amber" />
        <StatTile label="False positives" value={fmtNumber(c.fp)} sub="review cost / wasted alerts" accent="critical" />
      </div>

      <p className="mt-3 text-[11px] text-ink-3">
        Recall, F1, PR-AUC and ROC-AUC are intentionally omitted: each needs the true universe of positives, and undetected miscoding is by
        definition uncounted. We report only what alerts we raise can honestly support — <b>precision</b>, <b>alert workload</b> and <b>captured exposure&nbsp;$</b>.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>Precision vs. threshold</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="threshold" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip fmt={(v) => fmtPct(v, 1)} />} />
                <ReferenceLine x={threshold} stroke={CHART.amber} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="precision" name="Precision" stroke={CHART.cyan} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center text-[11px] text-ink-3">A higher cut raises precision at the cost of alert volume — the trade the Impact Simulator lets you set.</div>
        </Card>

        <Card className="p-4">
          <SectionLabel>Alert workload & captured exposure vs. threshold</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curve} margin={{ left: -8, right: 8 }}>
                <defs>
                  <linearGradient id="capExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.green} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.green} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="threshold" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis yAxisId="alerts" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis yAxisId="exp" orientation="right" tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => fmtCurrency(v, true)} width={52} />
                <Tooltip content={<ChartTooltip fmt={(v) => fmtNumber(v)} />} />
                <ReferenceLine x={threshold} stroke={CHART.amber} strokeDasharray="4 4" yAxisId="alerts" />
                <Area yAxisId="exp" type="monotone" dataKey="capturedExposure" name="Captured exposure $" stroke={CHART.green} strokeWidth={1.5} fill="url(#capExp)" />
                <Line yAxisId="alerts" type="monotone" dataKey="alerts" name="Alert volume" stroke={CHART.violet} dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center text-[11px] text-ink-3">Left axis: merchants alerted · Right axis: exposure $ captured on true positives.</div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <SectionLabel>Confusion matrix @ {threshold}</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Confusion label="True positive" value={c.tp} total={total} tone="bg-ok/15 text-ok" />
            <Confusion label="False positive" value={c.fp} total={total} tone="bg-amber/15 text-amber" />
            <Confusion label="False negative" value={c.fn} total={total} tone="bg-critical/15 text-critical" />
            <Confusion label="True negative" value={c.tn} total={total} tone="bg-surface-2 text-ink-2" />
          </div>
          <div className="mt-2 text-[11px] text-ink-3">
            {fmtNumber(total)} merchants classified against synthetic abuse flags. The false-negative cell is shown for completeness only —
            the real positive universe is unknowable, so it is not rolled into a recall figure.
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <SectionLabel>Feature importance (mean |contribution| on flagged merchants)</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.featureImportance} layout="vertical" margin={{ left: 60, right: 16 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis type="category" dataKey="id" tick={{ fill: CHART.axis, fontSize: 10 }} width={48} />
                <Tooltip cursor={{ fill: "#0f172a0a" }} content={<FeatTip />} />
                <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                  {metrics.featureImportance.map((_, i) => (
                    <Cell key={i} fill={i < 3 ? CHART.rose : CHART.cyan} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <SectionLabel>Per-typology precision & alert volume</SectionLabel>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-2 py-2 font-medium">Typology</th>
                <th className="px-2 py-2 text-right font-medium">Precision</th>
                <th className="px-2 py-2 text-right font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {metrics.byTypology.map((t) => (
                <tr key={t.typology} className="border-b border-border/40">
                  <td className="px-2 py-2">{t.label}</td>
                  <td className="px-2 py-2 text-right tnum text-cyan">{fmtPct(t.precision, 1)}</td>
                  <td className="px-2 py-2 text-right tnum text-violet">{fmtNumber(t.alerts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-3">
          Precision and alert volume are reported per typology; recall/support are omitted because the true per-typology positive count is not
          observable. Adjust the operating threshold in the <b>Impact Simulator</b> to trade precision against alert workload.
        </p>
      </Card>
    </div>
  );
}

function Confusion({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  return (
    <div className={`rounded-lg p-3 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-xl font-bold tnum">{fmtNumber(value)}</div>
      <div className="text-[10px] opacity-70">{fmtPct(total ? value / total : 0, 1)}</div>
    </div>
  );
}

function FeatTip({ active, payload }: { active?: boolean; payload?: { payload: { id: string; label: string; importance: number } }[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-card">
      <div className="font-semibold">{d.id} · {d.label}</div>
      <div className="text-ink-3 tnum">importance {d.importance.toFixed(2)}</div>
    </div>
  );
}
