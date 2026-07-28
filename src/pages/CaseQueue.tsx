import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, TierBadge, Button, Chip, EmptyState } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtCurrency, fmtDate, fmtDateTime } from "@/utils/format";
import {
  CASE_STATUSES, CASE_STATUS_LABELS, DISPOSITIONS, DISPOSITION_LABELS,
  RECOMMENDED_ACTIONS, RECOMMENDED_ACTION_LABELS, TIER_COLOR,
} from "@/features/cases/actions";
import { TYPOLOGY_LABELS, type CaseStatus } from "@/types/domain";
import { DATA_ANCHOR_MS } from "@/data/generator";
import { exportJson } from "@/utils/exports";

const STATUS_FILTERS: (CaseStatus | "ALL" | "OPEN")[] = ["ALL", "OPEN", ...CASE_STATUSES];

export default function CaseQueue() {
  const getCases = useAppStore((s) => s.getCases);
  const patchCase = useAppStore((s) => s.patchCase);
  const addNote = useAppStore((s) => s.addNote);
  const getRecord = useAppStore((s) => s.getRecord);
  const selectMerchant = useAppStore((s) => s.selectMerchant);
  const navigate = useNavigate();

  const cases = getCases();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("OPEN");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const filtered = useMemo(() => {
    const openStatuses = new Set<CaseStatus>(["new", "triage", "investigating", "escalated"]);
    return cases
      .filter((c) => filter === "ALL" ? true : filter === "OPEN" ? openStatuses.has(c.status) : c.status === filter)
      .sort((a, b) => b.modelScore - a.modelScore);
  }, [cases, filter]);

  const active = cases.find((c) => c.caseId === activeId) ?? filtered[0] ?? null;
  const record = active ? getRecord(active.merchantId) : undefined;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of CASE_STATUSES) c[k] = 0;
    for (const cs of cases) c[cs.status]++;
    return c;
  }, [cases]);

  if (cases.length === 0) {
    return <EmptyState title="No cases in the queue" hint="Cases are seeded from the highest-risk alerts when the engine runs." />;
  }

  const slaText = (ts: number) => {
    const days = Math.round((ts - DATA_ANCHOR_MS) / 86400000);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: "text-critical" };
    if (days === 0) return { text: "due today", cls: "text-amber" };
    return { text: `${days}d left`, cls: "text-ink-3" };
  };

  return (
    <div>
      <PageHeader
        icon="Briefcase"
        title="Case Queue"
        subtitle={`${cases.length} acquirer cases · ${cases.reduce((a, c) => a + c.merchantCount, 0)} merchants · dispositions and audit persist to this browser`}
        actions={
          active ? (
            <Button variant="ghost" onClick={() => exportJson(`case-${active.caseId}.json`, active)}>
              <Icon name="Download" size={15} /> Export case
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {s === "ALL" ? "All" : s === "OPEN" ? "Open" : CASE_STATUS_LABELS[s]}
            {s !== "ALL" && s !== "OPEN" ? <span className="ml-1 text-ink-3">{counts[s]}</span> : null}
          </Chip>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(340px,420px)_1fr]">
        {/* List */}
        <Card className="max-h-[74vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-ink-3">No cases match this filter.</div>
          ) : (
            filtered.map((c) => {
              const sla = slaText(c.slaDueAt);
              return (
                <button
                  key={c.caseId}
                  onClick={() => setActiveId(c.caseId)}
                  className={`mb-1 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ${c.caseId === active?.caseId ? "bg-cyan/10 ring-1 ring-cyan/40" : "hover:bg-surface-2"}`}
                >
                  <div className={`text-lg font-bold tnum ${TIER_COLOR[c.severity]}`}>{Math.round(c.modelScore)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{c.acquirerName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-3">{c.caseId}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-3">{c.merchantCount} merchant{c.merchantCount === 1 ? "" : "s"} · {TYPOLOGY_LABELS[c.typology]}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">{CASE_STATUS_LABELS[c.status]}</span>
                      <span className="rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber tnum">{fmtCurrency(c.totalFineUsd, true)} fine</span>
                      <span className={`text-[10px] ${sla.cls}`}>{sla.text}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </Card>

        {/* Detail */}
        {active && record ? (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold">{active.acquirerName}</h2>
                    <TierBadge tier={active.severity} small />
                  </div>
                  <div className="text-xs text-ink-3">{active.caseId} · acquirer {active.acquirerId} · {active.merchantCount} flagged merchant{active.merchantCount === 1 ? "" : "s"} · opened {fmtDate(active.createdAt)}</div>
                </div>
                <Button variant="ai" onClick={() => { selectMerchant(active.merchantId); navigate(`/investigate/${active.merchantId}`); }}>
                  <Icon name="ScanSearch" size={14} /> Investigate top merchant
                </Button>
              </div>

              <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3 text-xs text-ink-2">
                <span className="font-semibold text-ink">Hypothesis. </span>{active.hypothesis}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KV label="Rolled-up fine" value={fmtCurrency(active.totalFineUsd, true)} accent="text-amber" />
                <KV label="Merchants" value={String(active.merchantCount)} />
                <KV label="Prevented exposure" value={fmtCurrency(active.preventedExposure, true)} />
                <KV label="Assigned" value={active.assignedAnalyst} />
              </div>
            </Card>

            {/* Violating merchants — per-merchant fines rolling up to the total */}
            <Card className="p-4">
              <SectionLabel>Violating merchants · {active.merchantCount} · fines roll up to {fmtCurrency(active.totalFineUsd, true)}</SectionLabel>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="px-2 py-2 font-medium">Merchant</th>
                      <th className="px-2 py-2 font-medium">Typology</th>
                      <th className="px-2 py-2 text-right font-medium">Score</th>
                      <th className="px-2 py-2 text-right font-medium">Exposure</th>
                      <th className="px-2 py-2 text-right font-medium">Fine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.members.map((m) => (
                      <tr
                        key={m.merchantId}
                        className="cursor-pointer border-b border-border/40 hover:bg-surface-2"
                        onClick={() => { selectMerchant(m.merchantId); navigate(`/investigate/${m.merchantId}`); }}
                      >
                        <td className="px-2 py-2">
                          <span className="font-medium text-ink">{m.tradeName}</span>
                          <span className="ml-1.5 text-[10px] text-ink-3">{m.merchantId}</span>
                        </td>
                        <td className="px-2 py-2 text-ink-2">{TYPOLOGY_LABELS[m.typology]}</td>
                        <td className={`px-2 py-2 text-right tnum font-semibold ${TIER_COLOR[m.tier]}`}>{Math.round(m.modelScore)}</td>
                        <td className="px-2 py-2 text-right tnum text-ink-2">{fmtCurrency(m.exposure, true)}</td>
                        <td className="px-2 py-2 text-right tnum font-semibold text-amber">{fmtCurrency(m.fineUsd, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border text-[13px] font-bold">
                      <td className="px-2 py-2" colSpan={4}>Total proposed fine</td>
                      <td className="px-2 py-2 text-right tnum text-amber">{fmtCurrency(active.totalFineUsd, true)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-ink-3">Fines are directional, synthetic assessments for demonstration — not booked penalties. Click a merchant to open its investigation.</p>
            </Card>

            {/* Disposition controls — persist as accountable actions */}
            <Card className="p-4">
              <SectionLabel>Disposition · updates are logged to the audit trail</SectionLabel>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Select
                  label="Status"
                  value={active.status}
                  options={CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] }))}
                  onChange={(v) => patchCase(active.caseId, { status: v as CaseStatus }, `Status → ${CASE_STATUS_LABELS[v as CaseStatus]}`)}
                />
                <Select
                  label="Disposition"
                  value={active.disposition}
                  options={DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABELS[d] }))}
                  onChange={(v) => patchCase(active.caseId, { disposition: v as never }, `Disposition → ${DISPOSITION_LABELS[v as never]}`)}
                />
                <Select
                  label="Recommended action"
                  value={active.recommendedAction}
                  options={RECOMMENDED_ACTIONS.map((a) => ({ value: a, label: RECOMMENDED_ACTION_LABELS[a] }))}
                  onChange={(v) => patchCase(active.caseId, { recommendedAction: v as never }, `Action → ${RECOMMENDED_ACTION_LABELS[v as never]}`)}
                />
              </div>
              <div className="mt-2 text-[11px] text-ink-3">
                <Icon name="Info" size={12} className="mr-1 inline" />
                Decision-support only. Confirming abuse requires a named human reviewer and out-of-band verification.
              </div>
            </Card>

            {/* Notes */}
            <Card className="p-4">
              <SectionLabel>Investigator notes</SectionLabel>
              <div className="mt-2 space-y-2">
                {active.notes.length === 0 ? (
                  <div className="text-xs text-ink-3">No notes yet.</div>
                ) : (
                  active.notes.map((n) => (
                    <div key={n.id} className="rounded-lg border border-border bg-surface-2/40 p-2.5">
                      <div className="flex items-center justify-between text-[11px] text-ink-3">
                        <span className="font-medium text-ink-2">{n.author}</span>
                        <span>{fmtDateTime(n.timestamp)}</span>
                      </div>
                      <div className="mt-1 text-xs text-ink-2">{n.text}</div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && noteText.trim()) { addNote(active.caseId, noteText.trim()); setNoteText(""); } }}
                  placeholder="Add a note…"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-ink-3"
                />
                <button
                  onClick={() => { if (noteText.trim()) { addNote(active.caseId, noteText.trim()); setNoteText(""); } }}
                  className="text-cyan hover:text-cyan/80"
                >
                  <Icon name="ArrowRight" size={16} />
                </button>
              </div>
            </Card>

            {/* Audit */}
            <Card className="p-4">
              <SectionLabel>Audit trail</SectionLabel>
              <div className="mt-2 space-y-1.5">
                {active.audit.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    <Icon name="Check" size={12} className="text-ok" />
                    <span className="text-ink-2">{a.action}</span>
                    <span className="ml-auto text-ink-3">{a.actor} · {fmtDateTime(a.timestamp)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <EmptyState title="Select a case" hint="Choose a case from the queue to view and disposition it." />
        )}
      </div>
    </div>
  );
}

function KV({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tnum ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function Select({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-xs text-ink outline-none focus:border-cyan/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
