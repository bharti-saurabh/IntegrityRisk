import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import type { PinnedFinding } from "@/types/domain";
import type { AgentStep, StreamSource, StreamMetric } from "./agentStream";

// Reusable presentation for an agentic investigation stream. Plays back a
// deterministic AgentStep[] with a "thinking → line-by-line reveal" cadence,
// surfaces per-step evidence as gauges/badges, tracks lane progress + a live
// evidence scorecard, then exposes an optional follow-up Q&A box. Shared by the
// Plane A Investigation page and the Plane B cohort drill-down.

const SOURCE_META: Record<StreamSource, { label: string; cls: string; rail: string; tint: string }> = {
  internal: { label: "INTERNAL", cls: "text-cyan bg-cyan/10 border-cyan/30", rail: "bg-cyan", tint: "bg-cyan/[0.04]" },
  osint: { label: "SIMULATED OSINT", cls: "text-ai bg-violet/10 border-violet/30", rail: "bg-violet", tint: "bg-violet/[0.04]" },
  reasoning: { label: "AGENT", cls: "text-amber bg-amber/10 border-amber/30", rail: "bg-amber", tint: "bg-amber/[0.03]" },
};

const VERDICT_META: Record<string, { label: string; cls: string; icon: string }> = {
  corroborates: { label: "corroborates", cls: "text-critical", icon: "AlertTriangle" },
  mitigates: { label: "mitigates", cls: "text-ok", icon: "Check" },
  neutral: { label: "inconclusive", cls: "text-ink-3", icon: "Info" },
};

// Per-finding presentation: a corroborating "flag" reads red with an alert icon,
// a "mitigating" reads green with a check, everything else is a neutral note.
const LINE_TONE: Record<string, { icon: string; chip: string; wrap: string }> = {
  flag: { icon: "AlertTriangle", chip: "bg-critical/15 text-critical", wrap: "border-critical/20 bg-critical/[0.04]" },
  ok: { icon: "Check", chip: "bg-ok/15 text-ok", wrap: "border-ok/20 bg-ok/[0.04]" },
  muted: { icon: "Minus", chip: "bg-surface-2 text-ink-3", wrap: "border-border/60 bg-surface/40" },
};
const METRIC_TONE: Record<string, { text: string; bar: string; border: string }> = {
  flag: { text: "text-critical", bar: "bg-critical", border: "border-critical/25" },
  ok: { text: "text-ok", bar: "bg-ok", border: "border-ok/25" },
  muted: { text: "text-ink-2", bar: "bg-ink-3", border: "border-border" },
};

const LANES: { key: AgentStep["lane"]; short: string; icon: string }[] = [
  { key: "Plan", short: "Plan", icon: "Sparkles" },
  { key: "Internal data", short: "Internal", icon: "Activity" },
  { key: "OSINT", short: "OSINT", icon: "Globe" },
  { key: "Synthesis", short: "Verdict", icon: "Scale" },
];

// Deterministic, self-paced playback of the agent's investigation steps.
export function useStreamPlayback(steps: AgentStep[], runId: number) {
  const [cursor, setCursor] = useState<{ step: number; line: number; thinking: boolean }>({ step: 0, line: 0, thinking: true });
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let step = 0;
    let line = 0;

    const think = () => {
      if (cancelled) return;
      if (step >= steps.length) { setDone(true); return; }
      setCursor({ step, line: 0, thinking: true });
      timer = setTimeout(reveal, steps[step].durationMs);
    };
    const reveal = () => {
      if (cancelled) return;
      const count = steps[step].lines.length;
      if (line < count) {
        line += 1;
        setCursor({ step, line, thinking: false });
        timer = setTimeout(reveal, 320);
      } else {
        step += 1;
        line = 0;
        timer = setTimeout(think, 340);
      }
    };

    setCursor({ step: 0, line: 0, thinking: true });
    setDone(false);
    timer = setTimeout(think, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId, steps]);

  return { cursor, done };
}

interface Follow { q: string; a: string; }

export interface AgentStreamPanelProps {
  steps: AgentStep[];
  runId: number;
  /** Subject descriptors used to render the closing verdict card. */
  subjectName: string;
  suspectedLabel: string;
  suspectedScore: number;
  declaredMcc: string;
  disposition: string;
  scoreUnit?: "match" | "score"; // how to phrase the suspected score
  recommended?: string;
  hypothesis?: string;
  confidence?: number; // 0..1
  confidenceLabel?: string;
  /** Optional follow-up Q&A. Omit to hide the ask box (e.g. thin cohort rows). */
  quickPrompts?: { id: string; label: string }[];
  onAsk?: (promptId: string, freeText?: string) => string;
  /** Optional case write-back: files the completed investigation to the queue
   *  so it surfaces on the Command Center. Omit to hide the action. */
  caseAction?: { filed: boolean; onFile: () => void };
  footerNote?: string;
  /** Render flush inside a slide-over drawer (no outer Card chrome / height cap). */
  embedded?: boolean;
  /** Show a per-finding "Pin" control; pinned findings collect in the verdict summary. */
  enablePinning?: boolean;
  /** Notified whenever the pinned-findings set changes (for export / case write-back). */
  onPinnedChange?: (pins: PinnedFinding[]) => void;
  /** Seed pins so a re-opened investigation restores the analyst's prior selection. */
  initialPinned?: PinnedFinding[];
}

export function AgentStreamPanel(props: AgentStreamPanelProps) {
  const { steps, runId, subjectName, suspectedLabel, suspectedScore, declaredMcc, disposition } = props;
  const scoreUnit = props.scoreUnit ?? "match";
  const { cursor, done } = useStreamPlayback(steps, runId);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [input, setInput] = useState("");
  const [pinned, setPinned] = useState<PinnedFinding[]>(props.initialPinned ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Latest seed pins, read at replay time so re-opening an investigation
  // restores the analyst's prior pins instead of wiping them.
  const initialPinnedRef = useRef(props.initialPinned);
  initialPinnedRef.current = props.initialPinned;

  // A fresh run clears follow-ups; pins reset to the seed (empty on Plane A,
  // the merchant's stored pins when re-opened from the detection console).
  useEffect(() => { setFollows([]); setPinned(initialPinnedRef.current ?? []); }, [runId]);
  // Follow the newest content ONLY inside the embedded drawer, where the panel
  // owns a bounded internal scroll region. On the full page the panel flows at
  // natural height and the *page* owns the scroll — auto-driving it there would
  // fight the analyst trying to scroll up to the findings, so we leave it alone.
  useEffect(() => {
    if (!props.embedded) return;
    bottomRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursor, follows]); // eslint-disable-line react-hooks/exhaustive-deps
  // Surface pin changes to the parent (export brief / case write-back).
  useEffect(() => { props.onPinnedChange?.(pinned); }, [pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinnedIds = new Set(pinned.map((p) => p.id));
  const togglePin = (f: PinnedFinding) =>
    setPinned((prev) => (prev.some((p) => p.id === f.id) ? prev.filter((p) => p.id !== f.id) : [...prev, f]));

  const completed = done ? steps.length : cursor.step;
  const corroborating = steps.filter((s, i) => i < completed && s.verdict === "corroborates").length;
  const mitigating = steps.filter((s, i) => i < completed && s.verdict === "mitigates").length;
  const canAsk = !!props.onAsk;

  const askFree = () => {
    const text = input.trim();
    if (!text || !done || !props.onAsk) return;
    setFollows((prev) => [...prev, { q: text, a: props.onAsk!("", text) }]);
    setInput("");
  };

  const scorePhrase = scoreUnit === "match" ? `${Math.round(suspectedScore)}% match` : `score ${Math.round(suspectedScore)}/100`;

  // Lane progress: how many steps of each lane have completed.
  const laneState = LANES.map((ln) => {
    const total = steps.filter((s) => s.lane === ln.key).length;
    const doneCount = steps.filter((s, i) => s.lane === ln.key && i < completed).length;
    const activeHere = !done && steps[cursor.step]?.lane === ln.key;
    return { ...ln, total, doneCount, activeHere, complete: total > 0 && doneCount >= total };
  });

  const body = (
    <>
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet/30 to-cyan/30 text-ai">
          <Icon name="Sparkles" size={15} />
        </div>
        <div>
          <div className="text-sm font-bold">Autonomous Investigation</div>
          <div className="text-[10px] text-ink-3">Plans · pulls internal evidence · runs OSINT · synthesizes a cited verdict</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!done ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-cyan">
              <Icon name="Loader2" size={11} className="animate-spin" /> Running
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok">
              <Icon name="Check" size={11} /> Complete
            </span>
          )}
          <span className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] text-ai">Simulated</span>
        </div>
      </div>

      {/* lane tracker + live scorecard */}
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {laneState.map((ln, i) => (
            <div key={ln.key} className="flex flex-1 items-center gap-1.5">
              <div
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  ln.complete ? "border-cyan/30 bg-cyan/10 text-cyan" : ln.activeHere ? "border-amber/40 bg-amber/10 text-amber" : "border-border bg-surface-2 text-ink-3"
                }`}
              >
                <Icon name={ln.complete ? "Check" : ln.activeHere ? "Loader2" : ln.icon} size={11} className={ln.activeHere ? "animate-spin" : ""} />
                {ln.short}
                {ln.total > 1 ? <span className="opacity-60">{ln.doneCount}/{ln.total}</span> : null}
              </div>
              {i < laneState.length - 1 ? <div className={`h-px flex-1 ${ln.complete ? "bg-cyan/40" : "bg-border"}`} /> : null}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1 text-critical"><span className="h-1.5 w-1.5 rounded-full bg-critical" /> {corroborating} corroborating</span>
          <span className="inline-flex items-center gap-1 text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> {mitigating} mitigating</span>
          <span className="ml-auto text-ink-3">{completed}/{steps.length} lanes</span>
        </div>
      </div>

      {/* honesty banner */}
      <div className="flex items-start gap-2 border-b border-border bg-amber/[0.04] px-4 py-2 text-[10.5px] leading-snug text-ink-3">
        <Icon name="Info" size={12} className="mt-0.5 shrink-0 text-amber" />
        <span>
          Internal lanes read this merchant's real scored features. <b className="text-ink-2">OSINT lanes are simulated over synthetic data</b> —
          no live web, WHOIS, registry or watchlist calls are made. Wire a gateway to run them live.
        </span>
      </div>

      <div className={props.embedded ? "min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3" : "space-y-2.5 px-4 py-3"}>
        {steps.map((s, i) => {
          if (i > cursor.step) return null;
          const active = i === cursor.step;
          const revealed = active ? cursor.line : s.lines.length;
          const thinking = active && cursor.thinking;
          return (
            <StepBlock
              key={`${runId}-${s.id}`}
              step={s}
              revealed={revealed}
              thinking={thinking}
              active={active && !done}
              enablePinning={props.enablePinning}
              pinnedIds={pinnedIds}
              onTogglePin={togglePin}
            />
          );
        })}

        {done ? (
          <VerdictCard
            subjectName={subjectName}
            suspectedLabel={suspectedLabel}
            scorePhrase={scorePhrase}
            declaredMcc={declaredMcc}
            corroborating={corroborating}
            mitigating={mitigating}
            disposition={disposition}
            recommended={props.recommended}
            hypothesis={props.hypothesis}
            confidence={props.confidence}
            confidenceLabel={props.confidenceLabel}
            enablePinning={props.enablePinning}
            pinned={pinned}
            onUnpin={(id) => setPinned((prev) => prev.filter((p) => p.id !== id))}
          />
        ) : null}

        {follows.map((fw, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[92%] rounded-lg bg-cyan/15 px-3 py-2 text-xs text-ink">{fw.q}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs leading-relaxed text-ink-2 whitespace-pre-wrap">
              {fw.a}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {props.caseAction ? (
        <div className="border-t border-border p-3">
          {props.caseAction.filed ? (
            <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/[0.06] px-3 py-2 text-[11px] text-ink-2">
              <Icon name="Check" size={14} className="shrink-0 text-ok" />
              <span><b className="text-ink">Filed to the case queue.</b> It now shows on the Command Center under “Cases you filed”.</span>
            </div>
          ) : (
            <button
              disabled={!done}
              onClick={props.caseAction.onFile}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-2 text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/15 disabled:opacity-40"
            >
              <Icon name="Briefcase" size={14} /> File to case queue
              <span className="text-[10px] font-normal text-ink-3">— surfaces on the Command Center</span>
            </button>
          )}
        </div>
      ) : null}

      {canAsk ? (
        <div className="border-t border-border p-3">
          {props.quickPrompts && props.quickPrompts.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {props.quickPrompts.map((p) => (
                <button
                  key={p.id}
                  disabled={!done}
                  onClick={() => setFollows((prev) => [...prev, { q: p.label, a: props.onAsk!(p.id) }])}
                  className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-ink-2 hover:border-cyan/40 hover:text-cyan disabled:opacity-40"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askFree()}
              placeholder={done ? "Ask the agent a follow-up…" : "Agent is investigating…"}
              disabled={!done}
              className="w-full bg-transparent text-xs outline-none placeholder:text-ink-3 disabled:opacity-50"
            />
            <button onClick={askFree} disabled={!done} className="text-cyan hover:text-cyan/80 disabled:opacity-40">
              <Icon name="ArrowRight" size={16} />
            </button>
          </div>
          {props.footerNote ? <div className="mt-2 text-center text-[10px] text-ink-3">{props.footerNote}</div> : null}
        </div>
      ) : props.footerNote ? (
        <div className="border-t border-border px-3 py-2 text-center text-[10px] text-ink-3">{props.footerNote}</div>
      ) : null}
    </>
  );

  if (props.embedded) return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">{body}</div>;
  // Full-page: no height cap and no internal scroll region — the panel flows at
  // its natural height so the page scrolls cleanly to the verdict + file button.
  return <Card className="p-0" glow="cyan">{body}</Card>;
}

function MetricChip({ m }: { m: StreamMetric }) {
  const tone = METRIC_TONE[m.tone ?? "muted"];
  return (
    <div className={`rounded-lg border ${tone.border} bg-surface/60 px-2.5 py-1.5`}>
      <div className="text-[9px] uppercase tracking-wide text-ink-3">{m.label}</div>
      <div className={`mt-0.5 flex items-center gap-1 text-[12px] font-bold tnum ${tone.text}`}>
        {m.value}
        {m.tone === "flag" ? <Icon name="AlertTriangle" size={10} /> : m.tone === "ok" ? <Icon name="Check" size={10} /> : null}
      </div>
      {m.kind === "gauge" && m.bar != null ? (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(2, Math.min(100, m.bar * 100))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function StepBlock({
  step, revealed, thinking, active, enablePinning, pinnedIds, onTogglePin,
}: {
  step: AgentStep; revealed: number; thinking: boolean; active: boolean;
  enablePinning?: boolean; pinnedIds?: Set<string>; onTogglePin?: (f: PinnedFinding) => void;
}) {
  const src = SOURCE_META[step.source];
  const verdict = step.verdict ? VERDICT_META[step.verdict] : null;
  const complete = !active && revealed >= step.lines.length;
  const showMetrics = !thinking && step.metrics && step.metrics.length > 0;
  return (
    <div className={`flex gap-0 overflow-hidden rounded-lg border transition-colors ${active ? "border-cyan/40 " + src.tint : "border-border bg-surface-2/40"}`}>
      <div className={`w-1 shrink-0 ${src.rail} opacity-70`} />
      <div className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md border ${src.cls}`}>
            <Icon name={thinking ? "Loader2" : step.icon} size={13} className={thinking ? "animate-spin" : ""} />
          </span>
          <span className="text-[13px] font-semibold text-ink">{step.tool}</span>
          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${src.cls}`}>{src.label}</span>
          {complete && verdict ? (
            <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-semibold ${verdict.cls}`}>
              <Icon name={verdict.icon} size={11} /> {verdict.label}
            </span>
          ) : null}
        </div>

        {thinking ? (
          <div className="mt-1.5 flex items-center gap-1.5 pl-8 text-[11px] italic text-ink-3">
            {step.action}
            <span className="inline-block h-3 w-1 animate-pulse bg-cyan/60" />
          </div>
        ) : (
          <>
            {showMetrics ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5 pl-8 sm:grid-cols-3">
                {step.metrics!.map((m, i) => <MetricChip key={i} m={m} />)}
              </div>
            ) : null}
            <div className="mt-2 space-y-1 pl-8">
              {step.lines.slice(0, revealed).map((l, i) => {
                const isLast = active && i === revealed - 1;
                const li = LINE_TONE[l.tone ?? "muted"];
                const pinId = `${step.id}:${i}`;
                const isPinned = pinnedIds?.has(pinId) ?? false;
                return (
                  <div key={i} className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-[11.5px] leading-snug ${li.wrap}`}>
                    <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${li.chip}`}>
                      <Icon name={li.icon} size={10} />
                    </span>
                    <span className="min-w-0 flex-1 text-ink-2">
                      {l.text}
                      {l.cite ? <span className="ml-1 whitespace-nowrap rounded bg-surface px-1 py-px font-mono text-[9px] text-ink-3">{l.cite}</span> : null}
                      {isLast ? <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-cyan/60 align-middle" /> : null}
                    </span>
                    {enablePinning && !isLast ? (
                      <button
                        onClick={() => onTogglePin?.({ id: pinId, text: l.text, cite: l.cite, tone: l.tone })}
                        title={isPinned ? "Unpin from case summary" : "Pin to case summary"}
                        className={`mt-px flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold transition-colors ${
                          isPinned
                            ? "border-cyan/50 bg-cyan/15 text-cyan"
                            : "border-border bg-surface/60 text-ink-3 hover:border-cyan/40 hover:text-cyan"
                        }`}
                      >
                        <Icon name={isPinned ? "PinOff" : "Pin"} size={10} /> {isPinned ? "Pinned" : "Pin"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VerdictCard(props: {
  subjectName: string; suspectedLabel: string; scorePhrase: string; declaredMcc: string;
  corroborating: number; mitigating: number; disposition: string;
  recommended?: string; hypothesis?: string; confidence?: number; confidenceLabel?: string;
  enablePinning?: boolean; pinned?: PinnedFinding[]; onUnpin?: (id: string) => void;
}) {
  const conf = props.confidence != null ? Math.round(props.confidence * 100) : null;
  return (
    <div className="rounded-lg border border-cyan/30 bg-gradient-to-br from-cyan/[0.06] to-violet/[0.04] p-3.5">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan/15 text-cyan"><Icon name="Scale" size={13} /></div>
        <span className="text-[11px] font-bold uppercase tracking-wide text-cyan">Verdict</span>
        <span className="ml-auto inline-flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1 text-critical"><Icon name="AlertTriangle" size={10} /> {props.corroborating}</span>
          <span className="inline-flex items-center gap-1 text-ok"><Icon name="Check" size={10} /> {props.mitigating}</span>
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        {props.corroborating} lane(s) corroborate that <b className="text-ink">{props.subjectName}</b> behaves like a{" "}
        <b className="text-critical">{props.suspectedLabel}</b> ({props.scorePhrase}) while declared under a benign {props.declaredMcc} code.
        {props.hypothesis ? ` ${props.hypothesis}` : ""}
      </p>

      {conf != null ? (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] text-ink-3">
            <span>Confidence{props.confidenceLabel ? ` — ${props.confidenceLabel}` : ""}</span>
            <span className="font-semibold text-ink-2 tnum">{conf}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-violet" style={{ width: `${conf}%` }} />
          </div>
        </div>
      ) : null}

      {props.enablePinning ? (
        <div className="mt-3 border-t border-dashed border-border pt-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan">
            <Icon name="Pin" size={11} /> Analyst-pinned findings
            {props.pinned && props.pinned.length ? (
              <span className="rounded-full bg-cyan/15 px-1.5 py-px text-[9px] text-cyan tnum">{props.pinned.length}</span>
            ) : null}
          </div>
          {props.pinned && props.pinned.length ? (
            <div className="mt-2 space-y-1.5">
              {props.pinned.map((p) => {
                const li = LINE_TONE[p.tone ?? "muted"];
                return (
                  <div key={p.id} className="flex items-start gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-[11px]">
                    <span className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${li.chip}`}>
                      <Icon name={li.icon} size={10} />
                    </span>
                    <span className="min-w-0 flex-1 text-ink-2">
                      {p.text}
                      {p.cite ? <span className="ml-1 whitespace-nowrap rounded bg-surface px-1 py-px font-mono text-[9px] text-ink-3">{p.cite}</span> : null}
                    </span>
                    <button onClick={() => props.onUnpin?.(p.id)} title="Unpin from summary" className="mt-px shrink-0 text-ink-3 hover:text-critical">
                      <Icon name="X" size={12} />
                    </button>
                  </div>
                );
              })}
              <div className="text-[10px] text-ink-3">Carried into the Export brief and the filed case.</div>
            </div>
          ) : (
            <div className="mt-2 rounded-md border border-dashed border-border bg-surface/40 px-2.5 py-2 text-[11px] italic text-ink-3">
              Hit <b className="not-italic text-ink-2">Pin</b> on any finding above to build the case summary — pinned evidence carries into the Export brief and the filed case.
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-2.5 space-y-1.5">
        {props.recommended ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-[11px]">
            <Icon name="Target" size={12} className="mt-0.5 shrink-0 text-cyan" />
            <span className="text-ink-2"><b className="text-ink">Recommended:</b> {props.recommended}</span>
          </div>
        ) : null}
        <div className="flex items-start gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-[11px]">
          <Icon name="Briefcase" size={12} className="mt-0.5 shrink-0 text-amber" />
          <span className="text-ink-2"><b className="text-ink">Disposition:</b> {props.disposition}</span>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-ink-3">Decision-support only — a named human must sign off before any action.</div>
    </div>
  );
}
