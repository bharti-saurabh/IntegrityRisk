import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, TierBadge, Button, Chip, EmptyState } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { RiskRing } from "@/components/ui/RiskRing";
import { fmtCurrency, fmtPct, fmtNumber, fmtDateTime, maskCard } from "@/utils/format";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { TYPOLOGY_COLOR } from "@/features/cases/actions";
import { generateBrief, answerPrompt, COPILOT_PROMPTS } from "@/features/ai-copilot/narrative";
import { buildInvestigation, subjectFromRecord } from "@/features/ai-copilot/agentStream";
import { AgentStreamPanel } from "@/features/ai-copilot/AgentStreamPanel";
import { MCC_BY_CODE } from "@/data/mccTaxonomy";
import { exportMarkdown } from "@/utils/exports";
import type { PinnedFinding } from "@/types/domain";

function routePrompt(text: string): string {
  const q = text.toLowerCase();
  const hit = COPILOT_PROMPTS.find((p) => q.includes(p.id) || p.label.toLowerCase().split(" ").some((w) => w.length > 4 && q.includes(w)));
  if (hit) return hit.id;
  if (q.includes("mcc") || q.includes("categor")) return "mcc";
  if (q.includes("legit") || q.includes("explain")) return "legit";
  if (q.includes("escalat")) return "escalation";
  if (q.includes("action") || q.includes("recommend")) return "action";
  if (q.includes("weak") || q.includes("against")) return "weakest";
  return "why";
}

export default function Investigation() {
  const { merchantId } = useParams();
  const navigate = useNavigate();
  const records = useAppStore((s) => s.result!.records);
  const selectedId = useAppStore((s) => s.selectedMerchantId);
  const getTransactions = useAppStore((s) => s.getTransactions);
  const fileCase = useAppStore((s) => s.fileCase);
  const filedCases = useAppStore((s) => s.filedCases);

  const activeId = merchantId ?? selectedId ?? records[0]?.merchant.merchantId;
  const record = records.find((r) => r.merchant.merchantId === activeId);

  const transactions = useMemo(() => (record ? getTransactions(record.merchant.merchantId) : []), [record, getTransactions]);
  const brief = useMemo(() => (record ? generateBrief(record, transactions) : null), [record, transactions]);

  const subject = useMemo(
    () => (record && brief ? subjectFromRecord(record, transactions, brief) : null),
    [record, transactions, brief],
  );
  const steps = useMemo(() => (subject ? buildInvestigation(subject) : []), [subject]);

  const [runId, setRunId] = useState(0);
  const [pinnedFindings, setPinnedFindings] = useState<PinnedFinding[]>([]);

  // Reset the run whenever the merchant changes.
  useEffect(() => { setRunId((n) => n + 1); }, [activeId]);

  if (!record || !brief || !subject) {
    return <EmptyState title="Select a merchant to investigate" hint="Open the Data Explorer risk table or press ⌘K to search." />;
  }
  const m = record.merchant;
  const f = record.features;
  const top = record.archetypeMatches[0];

  const exportBrief = () => {
    const md = [
      `# Investigation Brief — ${m.tradeName} (${m.merchantId})`,
      ``,
      `> Decision-support only. Synthetic data. OSINT lanes are simulated. A named human must sign off before any action.`,
      ``,
      `**Composite risk:** ${record.scores.finalRiskScore}/100 (${record.scores.tier})`,
      `**Behaves like:** ${top.label} — ${Math.round(top.similarity)}% behavioral match (declared ${m.declaredMcc})`,
      `**Confidence:** ${fmtPct(brief.confidence)} — ${brief.confidenceLabel}`,
      ``,
      `## Executive summary`,
      brief.executiveSummary,
      ...(pinnedFindings.length
        ? [
            ``,
            `## Analyst-pinned findings`,
            ...pinnedFindings.map((p) => `- ${p.text}${p.cite ? ` [${p.cite}]` : ""}`),
          ]
        : []),
      ``,
      `## Agent investigation trace`,
      ...steps.map((s) => [
        `### ${s.tool} (${s.source})`,
        ...s.lines.map((l) => `- ${l.text}${l.cite ? ` [${l.cite}]` : ""}`),
      ].join("\n")),
      ``,
      `## Suggested disposition`,
      brief.suggestedDisposition,
    ].join("\n");
    exportMarkdown(`brief-${m.merchantId}.md`, md);
  };

  return (
    <div>
      <PageHeader
        icon="Sparkles"
        title="AI Investigation"
        subtitle={`${m.tradeName} · ${m.merchantId} — autonomous OSINT + internal-data agent`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/mcc")}>
              <Icon name="ScanSearch" size={15} /> MCC models
            </Button>
            <Button variant="ghost" onClick={() => setRunId((n) => n + 1)}>
              <Icon name="RotateCcw" size={15} /> Replay
            </Button>
            <Button variant="ghost" onClick={exportBrief}>
              <Icon name="Download" size={15} /> Export brief
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Evidence dossier */}
        <div className="min-w-0 space-y-4">
          <Card className="p-4" glow={record.scores.tier === "critical" ? "critical" : null}>
            <div className="flex flex-wrap items-center gap-4">
              <RiskRing score={record.scores.finalRiskScore} tier={record.scores.tier} size={104} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold">{m.tradeName}</h2>
                  <TierBadge tier={record.scores.tier} small />
                </div>
                <div className="text-xs text-ink-3">{m.legalName} · {m.city}, {m.state} · onboarded {m.onboardingDate}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <Chip>Declared {m.declaredMcc} · {MCC_BY_CODE[m.declaredMcc]?.category ?? m.declaredMcc}</Chip>
                  <Chip>Descriptor "{m.descriptor}"</Chip>
                </div>
                <div className="mt-2 rounded-lg border border-critical/20 bg-critical/[0.05] px-2.5 py-1.5 text-[11px] text-ink-2">
                  Behaves like a <b className="text-critical">{top.label.toLowerCase()}</b> — {Math.round(top.similarity)}% behavioral match.
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Rule", record.scores.ruleScore], ["Supervised", record.scores.supervisedScore],
                ["Anomaly", record.scores.anomalyScore], ["Graph", record.scores.graphScore],
                ["Surcharge", record.scores.surchargeScore], ["MCC mismatch", record.scores.mccMismatchScore],
                ["Behavior Δ", record.scores.behavioralChangeScore], ["Composite", record.scores.finalRiskScore],
              ].map(([label, val]) => (
                <div key={label as string} className="rounded-lg border border-border bg-surface-2/50 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
                  <div className="mt-0.5 text-sm font-bold tnum">{Number(val).toFixed(0)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between px-4 pt-4">
              <SectionLabel>Transaction sample</SectionLabel>
              <span className="text-[11px] text-ink-3">{fmtNumber(f.txnCount)} total · showing {Math.min(transactions.length, 30)}</span>
            </div>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Card</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 30).map((t) => (
                    <tr key={t.transactionId} className="border-t border-border/40">
                      <td className="px-4 py-1.5 text-ink-3 tnum">{fmtDateTime(t.timestamp)}</td>
                      <td className="px-3 py-1.5 tnum">{maskCard(t.cardId)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{fmtCurrency(t.amount)}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.entryMode}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          {t.cashEquivalent ? <span className="rounded bg-critical/15 px-1 text-[9px] text-critical">CASH</span> : null}
                          {t.refund ? <span className="rounded bg-amber/15 px-1 text-[9px] text-amber">REFUND</span> : null}
                          {t.walletLoad ? <span className="rounded bg-violet/15 px-1 text-[9px] text-ai">WALLET</span> : null}
                          {t.dispute ? <span className="rounded bg-high/15 px-1 text-[9px] text-high">DISPUTE</span> : null}
                          {t.crossBorder ? <span className="rounded bg-cyan/15 px-1 text-[9px] text-cyan">XBORDER</span> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Agentic investigation stream */}
        <div className="min-w-0">
          <AgentStreamPanel
            steps={steps}
            runId={runId}
            enablePinning
            onPinnedChange={setPinnedFindings}
            subjectName={m.tradeName}
            suspectedLabel={top.label.toLowerCase()}
            suspectedScore={top.similarity}
            declaredMcc={m.declaredMcc}
            disposition={subject.synthesis.disposition}
            recommended={subject.synthesis.recommended}
            hypothesis={subject.synthesis.hypothesis}
            confidence={subject.synthesis.confidence}
            confidenceLabel={subject.synthesis.confidenceLabel}
            scoreUnit="match"
            quickPrompts={COPILOT_PROMPTS.slice(0, 4)}
            onAsk={(promptId, freeText) =>
              answerPrompt(freeText ? routePrompt(freeText) : promptId, record, transactions)
            }
            caseAction={{
              filed: filedCases.some((c) => c.merchantId === m.merchantId),
              onFile: () =>
                fileCase({
                  merchantId: m.merchantId,
                  merchantName: m.tradeName,
                  familyLabel: TYPOLOGY_LABELS[record.primaryTypology],
                  familyColor:
                    record.primaryTypology === "CLEAN"
                      ? "#2563eb"
                      : TYPOLOGY_COLOR[record.primaryTypology],
                  suspectedLabel: top.label,
                  score: record.scores.finalRiskScore,
                  disposition: subject.synthesis.disposition,
                  recommended: subject.synthesis.recommended,
                  confidence: subject.synthesis.confidence,
                  href: `/investigate/${m.merchantId}`,
                  plane: "A",
                  pinnedFindings: pinnedFindings.length ? pinnedFindings : undefined,
                }),
            }}
            footerNote={`Leading typology: ${TYPOLOGY_LABELS[record.primaryTypology]} · Decision-support only — not a compliance determination.`}
          />
        </div>
      </div>
    </div>
  );
}
