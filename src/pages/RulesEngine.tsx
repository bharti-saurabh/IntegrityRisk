import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, Button, SectionLabel } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtNumber, fmtPct, fmtCurrency } from "@/utils/format";
import { TYPOLOGY_COLOR } from "@/features/cases/actions";
import { TYPOLOGY_LABELS, type Typology } from "@/types/domain";
import { registry, reviewQueueMetrics, type Model } from "@/data/models";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-critical", HIGH: "text-high", MEDIUM: "text-amber", LOW: "text-ink-2",
};

/* ----------------------------------------------------------- view-layer copy
   Plain-language statement of what each rule actually looks for — the "what is
   this rule" answer, kept out of the persisted Rule schema (which stores only
   the machine conditions). */
const RULE_PLAIN: Record<string, string> = {
  "RULE-MCC-001":
    "The merchant declared a benign, card-present retail category (grocery, restaurant, fuel…), yet almost every transaction is card-not-present and a large share settles overnight — the shape of a digital or high-risk operation hiding under a storefront code.",
  "RULE-MCC-002":
    "The merchant's behavioural fingerprint has drifted far from the peer profile of the category it declared. A model-derived divergence score above threshold, independent of any single signal.",
  "RULE-MCC-003":
    "Cash-equivalent load patterns (top-ups, quasi-cash) are appearing under a low-risk retail code — the tell of gaming or stored-value activity mis-coded as ordinary retail. Critical because a confirmed match is typically a prohibited product.",
  "RULE-SURCH-001":
    "An unusual share of card transactions are disputed as ‘unrecognised / unauthorised’ — the fingerprint of a surcharge the cardholder never expected at checkout.",
  "RULE-SURCH-002":
    "An elevated dispute-and-reversal rate on card fees — the chargeback fallout of surcharging over the jurisdictional cap or without disclosure.",
  "RULE-GEN-001":
    "High cross-border volume combined with heavy card-not-present activity — a pattern consistent with location masking around the declared category.",
};

const MCC_DETECTOR = registry.models.find((m) => m.family === "mcc_miscoding") ?? null;
const SURCHARGE_DETECTOR = registry.models.find((m) => m.family === "surcharge") ?? null;

/* Each rule scores the deterministic 15% of the ensemble for a given typology;
   the Model Store detector below scores the same typology from the learned
   signals. Link them so an analyst can see the model evidence behind a rule. */
function detectorForTypology(t: Typology): Model | null {
  if (t === "MCC_MISCODING") return MCC_DETECTOR;
  if (t === "CARD_SURCHARGE") return SURCHARGE_DETECTOR;
  return null;
}

export default function RulesEngine() {
  const nav = useNavigate();
  const rules = useAppStore((s) => s.rules);
  const records = useAppStore((s) => s.result!.records);
  const status = useAppStore((s) => s.status);
  const toggleRule = useAppStore((s) => s.toggleRule);
  const resetRules = useAppStore((s) => s.resetRules);

  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        subtitle="Detection rules are data, not hardcoded logic. Read what each rule looks for, see the Model Store detector behind it, and toggle one to re-score the whole portfolio in the worker."
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
          const expanded = expandedId === rule.id;
          const detector = detectorForTypology(rule.typology);
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

                  {/* Plain-language statement of what the rule is */}
                  {RULE_PLAIN[rule.id] ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{RULE_PLAIN[rule.id]}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {rule.conditions.map((c, i) => (
                      <span key={i} className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-2">
                        {c.feature} {c.operator} {Array.isArray(c.value) ? `[${c.value.join(", ")}]` : String(c.value)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
                    <span>score weight <b className="text-ink-2 tnum">+{rule.score}</b></span>
                    <span className="flex items-center gap-1">
                      <Icon name="Building2" size={12} />
                      fires on <b className="text-ink-2 tnum">{fmtNumber(hits)}</b> merchants
                    </span>
                    {detector ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : rule.id)}
                        className="flex items-center gap-1 font-medium text-ink-2 transition hover:text-ink"
                      >
                        <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={13} />
                        {expanded ? "Hide model backing" : "Backed by · Model Store"}
                      </button>
                    ) : null}
                  </div>

                  {/* ---- expandable: the Model Store detector behind this rule ---- */}
                  {expanded && detector ? (
                    <ModelBacking detector={detector} color={color} onOpen={() => nav("/models")} />
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        Rules contribute the deterministic component of the ensemble (weight {Math.round(0.15 * 100)}%); the learned Model Store
        detector for the same typology supplies the rest. Disabling a rule removes its score contribution and its explanations
        everywhere — merchant scores, typology attribution, cases, and model metrics all recompute. Model-backing figures are
        reported at the review-queue operating point (top-confidence slice).
      </p>
    </div>
  );
}

/* ---------------------------------------------------- Backed by · Model Store */
function ModelBacking({ detector, color, onOpen }: { detector: Model; color: string; onOpen: () => void }) {
  const m = reviewQueueMetrics(detector.metrics);
  return (
    <div className="mt-3 rounded-lg border border-border-soft bg-surface-2 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Backed by · Model Store</SectionLabel>
        <button type="button" onClick={onOpen} className="flex items-center gap-1 text-[11px] font-medium text-ink-2 transition hover:text-ink">
          Open detector <Icon name="ArrowRight" size={13} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Icon name="Radar" size={14} style={{ color }} />
        <span className="text-xs font-semibold text-ink">{detector.name}</span>
        <span className="rounded-md bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-3 tnum">v{detector.version}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <MiniStat label="Precision" value={fmtPct(m.precision, 0)} color={color} />
        <MiniStat label="Alert volume" value={fmtNumber(m.alertVolume)} />
        <MiniStat label="Captured exposure" value={fmtCurrency(m.capturedExposureUsd, true)} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
        Same typology, learned signals. This rule scores the deterministic slice; the detector above scores the rest of the
        ensemble for {TYPOLOGY_LABELS[detector.family === "surcharge" ? "CARD_SURCHARGE" : "MCC_MISCODING"]}.
      </p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-border-soft bg-canvas px-2.5 py-2">
      <div className="micro-label">{label}</div>
      <div className="mt-0.5 text-sm font-bold tnum" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
