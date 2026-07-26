import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar, Cell,
} from "recharts";
import { useAppStore, metricsAtThreshold } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, StatTile, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { CHART, ChartTooltip } from "@/components/charts/kit";
import { fmtPct, fmtNumber } from "@/utils/format";
import { exportJson } from "@/utils/exports";

export default function ModelObservatory() {
  const result = useAppStore((s) => s.result)!;
  const threshold = useAppStore((s) => s.threshold);
  const metrics = useMemo(() => metricsAtThreshold(result, threshold)!, [result, threshold]);

  const roc = metrics.curve;
  const c = metrics.confusion;
  const total = c.tp + c.fp + c.tn + c.fn;

  return (
    <div>
      <PageHeader
        icon="Activity"
        title="Model Observatory"
        subtitle="Detection metrics computed against synthetic ground truth · threshold = current alert cut"
        actions={
          <Button variant="ghost" onClick={() => exportJson("model-metrics.json", metrics)}>
            <Icon name="Download" size={15} /> Export metrics
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Precision" value={fmtPct(metrics.precision, 1)} sub={`@ threshold ${threshold}`} accent="cyan" />
        <StatTile label="Recall" value={fmtPct(metrics.recall, 1)} sub="of true abuse caught" accent="violet" />
        <StatTile label="F1" value={metrics.f1.toFixed(3)} accent="amber" />
        <StatTile label="ROC-AUC" value={metrics.rocAuc.toFixed(3)} sub="threshold-independent" accent="ok" />
        <StatTile label="PR-AUC" value={metrics.prAuc.toFixed(3)} accent="critical" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>Precision–recall vs. threshold</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={roc} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="threshold" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip fmt={(v) => fmtPct(v, 1)} />} />
                <ReferenceLine x={threshold} stroke={CHART.amber} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="precision" name="Precision" stroke={CHART.cyan} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="recall" name="Recall" stroke={CHART.violet} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="f1" name="F1" stroke={CHART.amber} dot={false} strokeWidth={1.5} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <SectionLabel>ROC curve</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...roc].sort((a, b) => a.fpr - b.fpr)} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke={CHART.grid} />
                <XAxis type="number" dataKey="fpr" domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} label={{ value: "FPR", fill: CHART.axis, fontSize: 10, position: "insideBottom", offset: -2 }} />
                <YAxis type="number" dataKey="tpr" domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip fmt={(v) => v.toFixed(3)} />} />
                <Line type="monotone" dataKey="tpr" name="TPR" stroke={CHART.cyan} dot={false} strokeWidth={2} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={CHART.grid} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center text-[11px] text-ink-3">Area under curve = {metrics.rocAuc.toFixed(3)}</div>
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
          <div className="mt-2 text-[11px] text-ink-3">{fmtNumber(total)} merchants classified against synthetic abuse flags.</div>
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
        <SectionLabel>Per-typology precision / recall</SectionLabel>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-2 py-2 font-medium">Typology</th>
                <th className="px-2 py-2 text-right font-medium">Precision</th>
                <th className="px-2 py-2 text-right font-medium">Recall</th>
                <th className="px-2 py-2 text-right font-medium">Support</th>
              </tr>
            </thead>
            <tbody>
              {metrics.byTypology.map((t) => (
                <tr key={t.typology} className="border-b border-border/40">
                  <td className="px-2 py-2">{t.label}</td>
                  <td className="px-2 py-2 text-right tnum text-cyan">{fmtPct(t.precision, 1)}</td>
                  <td className="px-2 py-2 text-right tnum text-violet">{fmtPct(t.recall, 1)}</td>
                  <td className="px-2 py-2 text-right tnum text-ink-2">{fmtNumber(t.support)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-3">
          Ground-truth labels exist only because the portfolio is synthetic; production monitoring would estimate these from confirmed dispositions.
          Adjust the operating threshold in the <b>Impact Simulator</b> to trade precision against recall.
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
