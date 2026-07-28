import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Area, ComposedChart,
} from "recharts";
import { useAppStore, metricsAtThreshold } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, StatTile } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { CHART, ChartTooltip } from "@/components/charts/kit";
import { fmtPct, fmtNumber, fmtCurrency } from "@/utils/format";
import { exposureForRecord } from "@/analytics/aggregates";
import { tierFor } from "@/analytics/scoring/ensemble";

export default function ImpactSimulator() {
  const result = useAppStore((s) => s.result)!;
  const threshold = useAppStore((s) => s.threshold);
  const setThreshold = useAppStore((s) => s.setThreshold);

  const metrics = useMemo(() => metricsAtThreshold(result, threshold)!, [result, threshold]);

  // Exposure captured / missed as a function of threshold (real, from records).
  const exposureCurve = useMemo(() => {
    const recs = result.records.map((r) => ({ score: r.scores.finalRiskScore, exp: exposureForRecord(r), bad: r.merchant.groundTruthAbuseFlag }));
    const totalExp = recs.reduce((a, r) => a + r.exp, 0);
    const pts = [];
    for (let t = 0; t <= 100; t += 4) {
      let captured = 0, alerts = 0;
      for (const r of recs) {
        if (r.score >= t) { captured += r.exp; alerts++; }
      }
      pts.push({
        threshold: t,
        capturedPct: totalExp ? captured / totalExp : 0,
        alerts,
        workloadPct: alerts / recs.length,
      });
    }
    return pts;
  }, [result.records]);

  // Live workload at current threshold.
  const live = useMemo(() => {
    let alerts = 0, capturedExp = 0, missedExp = 0;
    for (const r of result.records) {
      const exp = exposureForRecord(r);
      if (r.scores.finalRiskScore >= threshold) { alerts++; capturedExp += exp; }
      else if (r.merchant.groundTruthAbuseFlag) missedExp += exp;
    }
    return { alerts, capturedExp, missedExp, tier: tierFor(threshold) };
  }, [result.records, threshold]);

  const prData = metrics.curve.map((p) => ({ threshold: p.threshold, precision: p.precision, alerts: p.alerts }));

  return (
    <div>
      <PageHeader icon="SlidersHorizontal" title="Impact Simulator" subtitle="Move the alert threshold and watch precision, alert workload, and captured exposure react — live over the full portfolio" />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>Alert threshold</SectionLabel>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tnum text-cyan">{threshold}</span>
              <span className="text-xs text-ink-3">merchants scoring ≥ this become alerts · tier cut: <span className="capitalize">{live.tier}</span></span>
            </div>
          </div>
          <div className="flex gap-2">
            {[45, 62, 72, 80].map((t) => (
              <button key={t} onClick={() => setThreshold(t)} className={`rounded-lg border px-3 py-1.5 text-xs ${threshold === t ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-border bg-surface-2 text-ink-2 hover:text-ink"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <input
          type="range"
          min={20}
          max={95}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="mt-4 w-full accent-cyan"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-3">
          <span>20 · more alerts, more exposure captured</span>
          <span>95 · fewer alerts, higher precision</span>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Precision" value={fmtPct(metrics.precision, 1)} sub={`${fmtNumber(metrics.confusion.fp)} false positives`} accent="cyan" icon={<Icon name="Gauge" size={16} />} />
        <StatTile label="Confirmed alerts" value={fmtNumber(metrics.confusion.tp)} sub="true-positive merchants" accent="violet" icon={<Icon name="ShieldCheck" size={16} />} />
        <StatTile label="Alert workload" value={fmtNumber(live.alerts)} sub={`${fmtPct(live.alerts / result.records.length, 1)} of portfolio`} accent="amber" icon={<Icon name="Briefcase" size={16} />} />
        <StatTile label="Exposure captured" value={fmtCurrency(live.capturedExp, true)} sub={`${fmtCurrency(live.missedExp, true)} missed`} accent="critical" icon={<Icon name="AlertTriangle" size={16} />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>Precision vs. threshold</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prData} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="threshold" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip content={<ChartTooltip fmt={(v) => fmtPct(v, 1)} />} />
                <ReferenceLine x={threshold} stroke={CHART.amber} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="precision" name="Precision" stroke={CHART.cyan} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            Precision alone — recall is omitted because the true positive universe is unobservable. Read this against the exposure/workload curve to the right.
          </p>
        </Card>

        <Card className="p-4">
          <SectionLabel>Captured exposure vs. investigator workload</SectionLabel>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={exposureCurve} margin={{ left: -12, right: 8 }}>
                <defs>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.green} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="threshold" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={[0, 1]} tick={{ fill: CHART.axis, fontSize: 10 }} tickFormatter={(v) => fmtPct(v, 0)} />
                <Tooltip content={<ChartTooltip fmt={(v) => fmtPct(v, 1)} />} />
                <ReferenceLine x={threshold} stroke={CHART.amber} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="capturedPct" name="Exposure captured" stroke={CHART.green} fill="url(#gExp)" strokeWidth={2} />
                <Line type="monotone" dataKey="workloadPct" name="Workload (share alerted)" stroke={CHART.rose} dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            Lowering the threshold captures more exposure but grows the investigation queue. The knee of these curves is the efficient operating point.
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="flex items-start gap-2 text-xs text-ink-2">
          <Icon name="Info" size={14} className="mt-0.5 shrink-0 text-cyan" />
          <span>
            The threshold you set here is shared with the <b>Model Observatory</b> and drives which alerts surface across the app. All figures recompute in real time
            from the full scored portfolio — none are hardcoded. Exposure is a directional proxy on at-risk volume, not a booked loss figure.
          </span>
        </div>
      </Card>
    </div>
  );
}
