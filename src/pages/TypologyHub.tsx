import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, TierBadge, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtCurrency, fmtNumber, fmtPct } from "@/utils/format";
import { TYPOLOGY_COLOR, TIER_COLOR } from "@/features/cases/actions";
import { TYPOLOGY_LABELS, type Typology } from "@/types/domain";
import {
  ANATOMY_BY_TYPOLOGY,
  VALIDATION_TIER_LABEL,
  type ValidationTier,
} from "@/data/typologyAnatomy";

// The Hub is the portfolio router across the five rule-based detection modules:
// exposure at a glance, the merchants to look at, and where to go next — the
// detection module for hands-on work, or the Anatomy deck to learn the abuse.
// The "what it is / how it presents" teaching now lives entirely in /anatomy;
// what stays here is the compliance layer the deck doesn't cover — the
// validation ladder (signal → corroboration → confirmation) and regulatory hooks.
const MODULES: { typ: Exclude<Typology, "CLEAN">; route: string; anatomyKey: string; icon: string; blurb: string }[] = [
  { typ: "MCC_MISCODING", route: "/mcc", anatomyKey: "mcc_miscoding", icon: "ScanSearch", blurb: "One detection model per prohibited/restricted category (P1–P3). Each returns the cohort of merchants behaving like it but declared under a benign MCC." },
  { typ: "SPLIT_TICKETING", route: "/split", anatomyKey: "split_ticketing", icon: "Split", blurb: "Purchases deliberately split below monitoring thresholds to evade controls." },
  { typ: "FACTORING", route: "/factoring", anatomyKey: "factoring", icon: "Share2", blurb: "One merchant processing for undisclosed others via shared settlement / devices." },
  { typ: "FAKE_DESCRIPTOR", route: "/descriptors", anatomyKey: "descriptor", icon: "Type", blurb: "Deceptive or brand-mimicking descriptors driving 'not recognized' disputes." },
  { typ: "CASH_DISBURSEMENT", route: "/cash", anatomyKey: "cash", icon: "Banknote", blurb: "Card transactions converted to cash-equivalent value; round-dollar / wallet loads." },
];

const TIER_ICON: Record<ValidationTier, string> = {
  signal: "Zap",
  corroboration: "Network",
  confirmation: "Check",
};
const TIERS: ValidationTier[] = ["signal", "corroboration", "confirmation"];

export default function TypologyHub() {
  const records = useAppStore((s) => s.result!.records);
  const summaries = useAppStore((s) => s.result!.aggregates.typologySummaries);
  const navigate = useNavigate();
  const selectMerchant = useAppStore((s) => s.selectMerchant);
  const [expanded, setExpanded] = useState<Exclude<Typology, "CLEAN"> | null>(null);

  const byTypology = useMemo(() => {
    const map = new Map<Typology, typeof records>();
    for (const r of records) {
      const arr = map.get(r.primaryTypology) ?? [];
      arr.push(r);
      map.set(r.primaryTypology, arr);
    }
    return map;
  }, [records]);

  const totalAlerts = summaries.reduce((s, x) => s + (x.alerts ?? 0), 0);

  return (
    <div>
      <PageHeader
        icon="Layers"
        title="Typology Hub"
        subtitle="The five rule-based detection modules — portfolio exposure, the merchants to look at, and where to go next"
        actions={
          <Button variant="ghost" onClick={() => navigate("/anatomy")}>
            <Icon name="Fingerprint" size={15} /> Walk the anatomy
          </Button>
        }
      />

      {/* Router preamble: what this page is now, and the two paths off each card. */}
      <Card className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-cyan/10 text-cyan"><Icon name="Route" size={13} /></span>
          <span className="font-semibold text-ink">{fmtNumber(totalAlerts)} alerts</span> across five detection modules
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Icon name="ArrowRight" size={12} className="text-cyan" /> <span className="font-semibold text-cyan">Open module</span> to work a typology hands-on
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Icon name="Fingerprint" size={12} /> <span className="font-medium">Walk the anatomy</span> to learn how the abuse works
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {MODULES.map((mod) => {
          const summary = summaries.find((s) => s.typology === mod.typ);
          const list = (byTypology.get(mod.typ) ?? []).sort((a, b) => b.scores.finalRiskScore - a.scores.finalRiskScore);
          const top = list.slice(0, 3);
          const isOpen = expanded === mod.typ;
          const color = TYPOLOGY_COLOR[mod.typ];
          const anatomy = ANATOMY_BY_TYPOLOGY[mod.typ];
          return (
            <Card key={mod.typ} className={`flex flex-col p-4 transition-shadow ${isOpen ? "shadow-card-hover ring-1 ring-cyan/30" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}22`, color }}>
                  <Icon name={mod.icon} size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">{TYPOLOGY_LABELS[mod.typ]}</h3>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-3">{anatomy.alias}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{mod.blurb}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Alerts" value={fmtNumber(summary?.alerts ?? 0)} />
                <Stat label="Exposure" value={fmtCurrency(summary?.exposure ?? 0, true)} accent="text-amber" />
                <Stat label="Avg conf." value={fmtPct(summary?.avgConfidence ?? 0)} />
              </div>

              <div className="mt-3 border-t border-border pt-2">
                <SectionLabel>Top merchants</SectionLabel>
                <div className="mt-1.5 space-y-1">
                  {top.length === 0 ? (
                    <div className="text-[11px] text-ink-3">No merchants currently attributed.</div>
                  ) : (
                    top.map((r) => (
                      <button
                        key={r.merchant.merchantId}
                        onClick={() => { selectMerchant(r.merchant.merchantId); navigate(`/investigate/${r.merchant.merchantId}`); }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                      >
                        <span className={`text-base font-bold tnum ${TIER_COLOR[r.scores.tier]}`}>{Math.round(r.scores.finalRiskScore)}</span>
                        <span className="flex-1 truncate text-xs">{r.merchant.tradeName}</span>
                        <TierBadge tier={r.scores.tier} small />
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Compact compliance layer — the validation ladder + regulatory hooks. */}
              {isOpen ? <ValidationDetail typ={mod.typ} color={color} /> : null}

              {/* Actions: learn (anatomy), validate (this card), work (module). */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button
                  onClick={() => navigate(`/anatomy?family=${mod.anatomyKey}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <Icon name="Fingerprint" size={13} /> Walk the anatomy
                </button>
                <button
                  onClick={() => setExpanded(isOpen ? null : mod.typ)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <Icon name="ShieldCheck" size={13} />
                  {isOpen ? "Hide validation" : "Validate & report"}
                  <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={12} />
                </button>
                <button
                  onClick={() => navigate(mod.route)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan hover:bg-cyan/10"
                >
                  Open module <Icon name="ArrowRight" size={13} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* Validation ladder + regulatory hooks — the compliance content that does NOT
   live in the Anatomy deck. Kept compact: tier → method names + platform tag. */
function ValidationDetail({ typ, color }: { typ: Exclude<Typology, "CLEAN">; color: string }) {
  const a = ANATOMY_BY_TYPOLOGY[typ];
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded" style={{ background: `${color}1a`, color }}>
          <Icon name="ShieldCheck" size={12} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-2">How we validate — signal to defensible finding</span>
      </div>
      <div className="mt-2 space-y-2">
        {TIERS.map((tier) => {
          const rungs = a.validationLadder.filter((v) => v.tier === tier);
          if (rungs.length === 0) return null;
          return (
            <div key={tier} className="flex gap-2">
              <div className="flex w-24 shrink-0 items-center gap-1 pt-0.5">
                <Icon name={TIER_ICON[tier]} size={11} className="text-ink-3" />
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">{VALIDATION_TIER_LABEL[tier]}</span>
              </div>
              <div className="flex-1 space-y-1">
                {rungs.map((v) => (
                  <div key={v.method} className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-medium text-ink">{v.method}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${v.inPlatform ? "bg-ok/10 text-ok" : "bg-violet/10 text-ai"}`}>
                      {v.inPlatform ? "in-platform" : "external"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-wide text-ink-3">Regulatory hooks</span>
        {a.regulatoryHooks.map((h) => (
          <span key={h} className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] text-ink-2">{h}</span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tnum ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
