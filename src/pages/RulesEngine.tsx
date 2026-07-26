import { useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtNumber } from "@/utils/format";
import { TYPOLOGY_COLOR } from "@/features/cases/actions";
import { TYPOLOGY_LABELS, type Typology } from "@/types/domain";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-critical", HIGH: "text-high", MEDIUM: "text-amber", LOW: "text-ink-2",
};

export default function RulesEngine() {
  const rules = useAppStore((s) => s.rules);
  const records = useAppStore((s) => s.result!.records);
  const status = useAppStore((s) => s.status);
  const toggleRule = useAppStore((s) => s.toggleRule);
  const resetRules = useAppStore((s) => s.resetRules);

  // Live hit-count per rule from the current scored portfolio.
  const hitCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) for (const h of r.ruleHits) map.set(h.ruleId, (map.get(h.ruleId) ?? 0) + 1);
    return map;
  }, [records]);

  const busy = status === "loading";

  return (
    <div>
      <PageHeader
        icon="Filter"
        title="Rules Engine"
        subtitle="Detection rules are data, not hardcoded logic. Toggle one and the whole portfolio re-scores in the worker."
        actions={
          <Button variant="ghost" onClick={() => resetRules()} disabled={busy}>
            <Icon name="RotateCcw" size={15} /> Reset to defaults
          </Button>
        }
      />

      {busy ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs text-cyan">
          <Icon name="Activity" size={14} className="animate-pulseglow" /> Re-scoring portfolio…
        </div>
      ) : null}

      <div className="space-y-2.5">
        {rules.map((rule) => {
          const hits = hitCounts.get(rule.id) ?? 0;
          const color = rule.typology === "CLEAN" ? "#64748b" : TYPOLOGY_COLOR[rule.typology as Exclude<Typology, "CLEAN">];
          return (
            <Card key={rule.id} className={`p-4 ${rule.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggleRule(rule.id)}
                  disabled={busy}
                  className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${rule.enabled ? "bg-cyan/80" : "bg-surface-2"}`}
                  aria-label="Toggle rule"
                >
                  <span className={`h-5 w-5 rounded-full bg-canvas transition-transform ${rule.enabled ? "translate-x-5" : ""}`} />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-3">{rule.id}</span>
                    <span className="text-sm font-semibold">{rule.name}</span>
                    <span className={`text-[11px] font-bold ${SEV_COLOR[rule.severity]}`}>{rule.severity}</span>
                    <span className="text-[11px]" style={{ color }}>· {TYPOLOGY_LABELS[rule.typology]}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {rule.conditions.map((c, i) => (
                      <span key={i} className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-2">
                        {c.feature} {c.operator} {Array.isArray(c.value) ? `[${c.value.join(", ")}]` : String(c.value)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3">
                    <span>score weight <b className="text-ink-2 tnum">+{rule.score}</b></span>
                    <span className="flex items-center gap-1">
                      <Icon name="Building2" size={12} />
                      fires on <b className="text-ink-2 tnum">{fmtNumber(hits)}</b> merchants
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-ink-3">
        Rules contribute the deterministic component of the ensemble (weight {Math.round(0.15 * 100)}%). Disabling a rule removes its score
        contribution and its explanations everywhere — merchant scores, typology attribution, cases, and model metrics all recompute.
      </p>
    </div>
  );
}
