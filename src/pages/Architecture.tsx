import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtNumber } from "@/utils/format";
import { ENSEMBLE_WEIGHTS } from "@/analytics/scoring/ensemble";

const PIPELINE = [
  { icon: "Building2", title: "Synthetic data engine", body: "Deterministic seeded generator builds merchants, customers, cards, and 100k+ transactions with injected typologies and ground-truth labels. No real PII, cards, or proprietary data." },
  { icon: "Gauge", title: "Feature engineering", body: "40+ per-merchant features: channel mix, timing, ticket distribution, cash-equivalent markers, descriptor NLP, and peer z-scores grouped by declared MCC." },
  { icon: "Filter", title: "Rules engine", body: "Transparent, data-driven rules per typology. Editable and toggleable at runtime; each fired rule emits a scored, templated explanation." },
  { icon: "ScanSearch", title: "MCC classifier", body: "Nearest-behavioral-profile model with Gaussian matching + softmax. Predicts the category the behavior actually resembles and quantifies mismatch severity." },
  { icon: "Share2", title: "Graph analytics", body: "Entity resolution over shared settlement accounts, devices, IPs, and owners; distance-weighted known-bad adjacency scoring." },
  { icon: "Activity", title: "Ensemble scoring", body: "Seven weighted components combine into a 0–100 composite with SHAP-style feature attributions for full explainability." },
  { icon: "Sparkles", title: "AI copilot", body: "Deterministic narrative generator grounds every claim in this merchant's evidence and cites feature IDs — supporting and mitigating. Optional external LLM adapter, never with a committed key." },
];

export default function Architecture() {
  const meta = useAppStore((s) => s.result!.meta);
  const agg = useAppStore((s) => s.result!.aggregates);

  const weights = Object.entries(ENSEMBLE_WEIGHTS) as [string, number][];

  return (
    <div>
      <PageHeader icon="Workflow" title="Architecture & Method" subtitle="How the command center turns synthetic data into scored, explainable integrity risk" />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <SectionLabel>Data version</SectionLabel>
          <div className="mt-1 font-mono text-sm">{meta.dataVersion}</div>
        </Card>
        <Card className="p-4">
          <SectionLabel>Transactions scored</SectionLabel>
          <div className="mt-1 text-sm font-bold tnum text-cyan">{fmtNumber(meta.totalTransactions)}</div>
        </Card>
        <Card className="p-4">
          <SectionLabel>Merchants monitored</SectionLabel>
          <div className="mt-1 text-sm font-bold tnum text-cyan">{fmtNumber(agg.merchantsMonitored)}</div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <SectionLabel>Detection pipeline (runs in a Web Worker)</SectionLabel>
          <div className="mt-3 space-y-2">
            {PIPELINE.map((step, i) => (
              <div key={step.title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan">
                    <Icon name={step.icon} size={16} />
                  </div>
                  {i < PIPELINE.length - 1 ? <div className="my-0.5 w-px flex-1 bg-border" /> : null}
                </div>
                <div className="pb-2">
                  <div className="text-sm font-semibold">{step.title}</div>
                  <div className="text-[12px] leading-relaxed text-ink-3">{step.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionLabel>Ensemble weights</SectionLabel>
            <div className="mt-3 space-y-2">
              {weights.map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-[11px]">
                    <span className="capitalize text-ink-2">{k.replace(/([A-Z])/g, " $1")}</span>
                    <span className="tnum text-ink-3">{Math.round(v * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan to-violet" style={{ width: `${v * 100 / 0.2 * 100}%`, maxWidth: "100%" }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <SectionLabel>Guardrails</SectionLabel>
            <ul className="mt-2 space-y-1.5 text-[12px] text-ink-2">
              <li className="flex gap-2"><Icon name="Check" size={13} className="mt-0.5 shrink-0 text-ok" /> Synthetic data only — no real PII, cards, or merchants.</li>
              <li className="flex gap-2"><Icon name="Check" size={13} className="mt-0.5 shrink-0 text-ok" /> Card identifiers masked everywhere (•••• 8294).</li>
              <li className="flex gap-2"><Icon name="Check" size={13} className="mt-0.5 shrink-0 text-ok" /> Outputs are decision-support, not final compliance determinations.</li>
              <li className="flex gap-2"><Icon name="Check" size={13} className="mt-0.5 shrink-0 text-ok" /> No API keys in frontend; public demo needs none.</li>
              <li className="flex gap-2"><Icon name="Check" size={13} className="mt-0.5 shrink-0 text-ok" /> Fully client-side and reproducible from a fixed seed.</li>
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <SectionLabel>Reproducibility</SectionLabel>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
          The entire portfolio is generated from seed <span className="font-mono text-cyan">{String(meta.config.seed)}</span> using a deterministic
          RNG (mulberry32 over a hashed seed). No <span className="font-mono">Math.random</span> or wall-clock time enters the generators or models, so the same
          seed always yields identical merchants, transactions, scores, and metrics — the demo is byte-for-byte reproducible across machines and reloads.
        </p>
      </Card>
    </div>
  );
}
