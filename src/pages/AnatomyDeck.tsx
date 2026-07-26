import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/primitives";
import { fmtCurrency, fmtNumber, fmtPct } from "@/utils/format";
import { PRIORITY_TIER_HEX, TIER_HEX } from "@/data/overview";
import {
  families, GLOSSARY, TELL_META,
  type AnatomyFamily, type Deviation,
  type SigFingerprint, type SigInterchange, type SigSplit,
  type SigFactoring, type SigDescriptor, type SigCash,
} from "@/data/anatomy";

/* ---------------------------------------------------------------- helpers */
const delay = (i: number, step = 70): React.CSSProperties =>
  ({ ["--d" as string]: `${i * step}ms` } as React.CSSProperties);

function tint(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
function prefersReduced(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
/** Count a number up from 0 → target whenever `run` changes (scene/replay). */
function useCountUp(target: number, run: number, ms = 750): number {
  const [v, setV] = useState(() => (prefersReduced() ? target : 0));
  useEffect(() => {
    if (prefersReduced()) { setV(target); return; }
    let raf = 0, start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, run, ms]);
  return v;
}
function fmtDev(v: number, kind: Deviation["kind"]): string {
  if (kind === "pct") return fmtPct(v, 0);
  if (kind === "usd") return fmtCurrency(v, true);
  if (kind === "bps") return `${Math.round(v)} bps`;
  return Number.isInteger(v) ? fmtNumber(v) : v.toFixed(1);
}
function tierHex(t: string): string {
  return (TIER_HEX as Record<string, string>)[t] ?? "#64748b";
}
const ROUTE_META: Record<"model" | "rule" | "both", { label: string; color: string; note: string }> = {
  model: { label: "Model-routed", color: "#2563eb", note: "the learned model flagged it" },
  rule: { label: "Rule-routed", color: "#d97706", note: "a bright-line rule flagged it — not the model" },
  both: { label: "Model + rule", color: "#7c3aed", note: "the model and a rule agreed" },
};

const SCENE_KEYS = ["hero", "cover", "stream", "deviation", "signature", "score", "verdict"] as const;
type SceneKey = typeof SCENE_KEYS[number];
const SCENE_RIBBON: Record<SceneKey, string> = {
  hero: "Overview", cover: "Cover story", stream: "Transactions",
  deviation: "Peer deviation", signature: "Signature", score: "Score & routing", verdict: "Verdict",
};
const SIG_TITLE: Record<string, string> = {
  mcc_miscoding: "Content fingerprint", mcc_abuse: "Interchange band",
  split_ticketing: "Split-ticket bursts", factoring: "Sub-merchant fan-out",
  descriptor: "Descriptor rotation", cash: "Amount profile",
};
function sceneTitle(key: SceneKey, fam: AnatomyFamily): string {
  return key === "signature" ? SIG_TITLE[fam.key] : SCENE_RIBBON[key];
}

/* ---------------------------------------------------------------- atoms */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="mx-0.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-2 shadow-sm">{children}</kbd>;
}
function SceneShell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-col justify-center py-2">{children}</div>;
}
function RoutingChip({ by }: { by: "model" | "rule" | "both" }) {
  const m = ROUTE_META[by];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: tint(m.color, 0.12), color: m.color }}>
      <Icon name={by === "rule" ? "Scale" : by === "both" ? "Zap" : "Cpu"} size={12} />
      {m.label}
    </span>
  );
}
function StatTile({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="micro-label text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-bold tnum" style={{ color: accent ?? "#0f172a" }}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div> : null}
    </div>
  );
}
function TeachRow({ icon, title, children, i }: { icon: string; title: string; children: React.ReactNode; i: number }) {
  return (
    <div className="anat-rise flex gap-3" style={delay(i)}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</div>
        <div className="mt-0.5 text-sm text-ink-2">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero motifs */
function Motif({ fam, size = 128 }: { fam: AnatomyFamily; size?: number }) {
  const c = fam.color;
  const common = { width: size, height: size, viewBox: "0 0 128 128", fill: "none" as const };
  switch (fam.key) {
    case "mcc_miscoding": // benign card peeling off a red vertical behind
      return (
        <svg {...common} aria-hidden>
          <rect x="30" y="34" width="72" height="52" rx="8" fill={tint("#e11d48", 0.16)} stroke="#e11d48" strokeWidth="2" />
          <text x="66" y="64" textAnchor="middle" fontSize="9" fontWeight="700" fill="#e11d48">TRUE VERTICAL</text>
          <g className="anat-float">
            <rect x="20" y="44" width="72" height="52" rx="8" fill={tint(c, 0.14)} stroke={c} strokeWidth="2" />
            <rect x="30" y="54" width="30" height="6" rx="3" fill={c} opacity="0.7" />
            <text x="56" y="86" textAnchor="middle" fontSize="9" fontWeight="700" fill={c}>MCC 5999</text>
          </g>
        </svg>
      );
    case "mcc_abuse": { // gauge: needle low (declared), ghost tick high (expected)
      const arc = "M 24 92 A 40 40 0 0 1 104 92";
      return (
        <svg {...common} aria-hidden>
          <path d={arc} stroke="#e3e8f0" strokeWidth="8" strokeLinecap="round" />
          <path d="M 24 92 A 40 40 0 0 1 52 55" className="anat-draw" style={{ ["--len" as string]: 90 }} stroke={c} strokeWidth="8" strokeLinecap="round" />
          <line x1="64" y1="92" x2="40" y2="66" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <circle cx="64" cy="92" r="5" fill={c} />
          <circle cx="98" cy="70" r="3.5" fill="#e11d48" className="anat-pulse" />
          <text x="98" y="60" textAnchor="middle" fontSize="8" fill="#e11d48">owed</text>
        </svg>
      );
    }
    case "split_ticketing": // ceiling line + tall bar shattering into fragments
      return (
        <svg {...common} aria-hidden>
          <line x1="16" y1="46" x2="112" y2="46" stroke="#e11d48" strokeWidth="2" strokeDasharray="5 4" />
          <text x="112" y="41" textAnchor="end" fontSize="8" fill="#e11d48">ceiling</text>
          <rect x="24" y="50" width="14" height="46" rx="2" className="anat-grow-y" fill={tint(c, 0.85)} />
          {[0, 1, 2, 3].map((n) => (
            <rect key={n} x={54 + n * 15} y={62 + (n % 2) * 4} width="11" height={34 - (n % 2) * 4} rx="2"
              className="anat-grow-y" style={delay(n + 1, 90)} fill={c} />
          ))}
        </svg>
      );
    case "factoring": { // hub with spokes to sub nodes
      const nodes = [[28, 40], [104, 44], [30, 96], [100, 96]];
      return (
        <svg {...common} aria-hidden>
          {nodes.map(([x, y], n) => (
            <line key={n} x1="64" y1="68" x2={x} y2={y} className="anat-draw" style={{ ["--len" as string]: 60, ...delay(n, 90) }} stroke={tint(c, 0.5)} strokeWidth="2" />
          ))}
          {nodes.map(([x, y], n) => (
            <circle key={n} cx={x} cy={y} r="9" className="anat-pop" style={delay(n + 1, 90)} fill={tint("#e11d48", 0.18)} stroke="#e11d48" strokeWidth="1.5" />
          ))}
          <circle cx="64" cy="68" r="15" fill={tint(c, 0.16)} stroke={c} strokeWidth="2.5" />
          <text x="64" y="72" textAnchor="middle" fontSize="9" fontWeight="700" fill={c}>MID</text>
        </svg>
      );
    }
    case "descriptor": // fanned name plates rotating
      return (
        <svg {...common} aria-hidden>
          {[[-9, 0.35], [-4.5, 0.6], [0, 1]].map(([rot, op], n) => (
            <g key={n} transform={`rotate(${rot} 64 70)`} opacity={op} className={n === 2 ? "anat-float" : undefined}>
              <rect x="30" y="52" width="68" height="20" rx="4" fill={tint(c, 0.13)} stroke={c} strokeWidth="1.6" />
              <rect x="36" y="59" width={26 + n * 8} height="6" rx="3" fill={c} opacity="0.75" />
            </g>
          ))}
        </svg>
      );
    case "cash": // card -> arrow -> cash stack, crossed goods
      return (
        <svg {...common} aria-hidden>
          <rect x="16" y="52" width="34" height="24" rx="4" fill={tint(c, 0.14)} stroke={c} strokeWidth="2" />
          <rect x="20" y="58" width="14" height="4" rx="2" fill={c} opacity="0.7" />
          <path d="M 54 64 L 72 64 M 68 59 L 74 64 L 68 69" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="anat-pulse" />
          {[0, 1, 2].map((n) => (
            <rect key={n} x="80" y={70 - n * 8} width="32" height="10" rx="2" className="anat-grow-y" style={delay(n, 90)} fill={tint("#059669", 0.7 - n * 0.15)} stroke="#059669" strokeWidth="1.2" />
          ))}
          <g opacity="0.4"><rect x="80" y="86" width="20" height="16" rx="2" stroke="#e11d48" strokeWidth="1.6" /><line x1="80" y1="86" x2="100" y2="102" stroke="#e11d48" strokeWidth="1.6" /></g>
        </svg>
      );
  }
}

/* ---------------------------------------------------------------- scenes */
function HeroScene({ fam }: { fam: AnatomyFamily }) {
  const e = fam.edu;
  return (
    <SceneShell>
      <div className="mx-auto grid w-full max-w-4xl items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="anat-rise micro-label" style={{ ...delay(0), color: fam.color }}>{fam.label}</div>
          <h1 className="anat-rise mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl" style={delay(1)}>
            {e.tagline}
          </h1>
          <p className="anat-rise mt-3 max-w-xl text-sm leading-relaxed text-ink-2" style={delay(2)}>{e.definition}</p>
          <div className="mt-6 space-y-4">
            <TeachRow icon="Eye" title="Think of it as" i={3}>{e.analogy}</TeachRow>
            <TeachRow icon="TrendingDown" title="Why it costs money" i={4}>{e.cost}</TeachRow>
          </div>
          <div className="anat-rise mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-ink-3" style={delay(5)}>
            Press <Kbd>Space</Kbd> to walk one real (synthetic) case
          </div>
        </div>
        <div className="anat-pop mx-auto flex h-40 w-40 items-center justify-center rounded-3xl md:h-52 md:w-52"
          style={{ ...delay(1), background: `radial-gradient(circle at 40% 30%, ${tint(fam.color, 0.14)}, ${tint(fam.color, 0.04)})`, border: `1px solid ${tint(fam.color, 0.25)}` }}>
          <Motif fam={fam} size={148} />
        </div>
      </div>
    </SceneShell>
  );
}

function CoverStoryScene({ fam }: { fam: AnatomyFamily }) {
  const id = fam.identity;
  const rows: [string, string][] = [
    ["Declared MCC", `${id.declaredMcc} · ${id.declaredAs}`],
    ["Registered", [id.city, id.country].filter(Boolean).join(", ") || "—"],
    ["Corporate parent", id.corp || "—"],
    ["Transactions", `${fmtNumber(id.txnCount)} over ${id.activeDays} active days`],
    ["Gross settled", fmtCurrency(id.grossSalesUsd)],
  ];
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <p className="anat-rise mb-3 text-center text-sm text-ink-3" style={delay(0)}>
          This is everything the acquiring bank was told when it onboarded the merchant.
        </p>
        <div className="anat-pop rounded-2xl border border-ok/25 bg-ok/5 p-6" style={delay(1)}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ok/15 text-ok"><Icon name="Building2" size={22} /></span>
            <div>
              <div className="text-lg font-bold text-ink">{id.name}</div>
              <div className="text-xs text-ok">Presents as an ordinary, low-risk merchant</div>
            </div>
          </div>
          <dl className="mt-5 divide-y divide-border-soft">
            {rows.map(([k, v], i) => (
              <div key={k} className="anat-rise flex items-start justify-between gap-6 py-2.5 text-sm" style={delay(i + 2)}>
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="anat-rise mt-4 text-center text-xs text-ink-3" style={delay(8)}>
          Nothing in the paperwork is alarming. The story is in how it actually transacts.
        </p>
      </div>
    </SceneShell>
  );
}

function StreamScene({ fam }: { fam: AnatomyFamily }) {
  const legend = fam.tells;
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="anat-rise mb-3 flex flex-wrap items-center gap-2" style={delay(0)}>
          <span className="text-xs font-medium text-ink-3">Tells for this typology:</span>
          {legend.map((t) => (
            <span key={t.tag} title={t.why}
              className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium"
              style={{ color: TELL_META[t.tag].color }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TELL_META[t.tag].color }} />
              {TELL_META[t.tag].label}
            </span>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 border-b border-border bg-surface-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <span>Date · hour</span><span>Channel · route</span><span className="text-right">Amount</span>
          </div>
          <div className="max-h-[50vh] divide-y divide-border-soft overflow-y-auto">
            {fam.transactions.map((t, i) => {
              const flagged = t.tells.length > 0;
              return (
                <div key={i} className="anat-rise grid grid-cols-[auto_1fr_auto] items-center gap-x-4 px-4 py-2 text-xs"
                  style={{ ...delay(i, 45), opacity: flagged ? 1 : 0.45, backgroundColor: flagged ? tint(fam.color, 0.04) : undefined }}>
                  <div className="tnum text-ink-2">
                    <div>{t.time.slice(5, 10)}</div>
                    <div className={`text-[10px] ${t.hour <= 5 || t.hour >= 23 ? "font-bold text-violet" : "text-ink-3"}`}>{String(t.hour).padStart(2, "0")}:00</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{t.channel}</span>
                      <span className="text-ink-3">{t.issuer}→{t.acquirer}</span>
                      {!t.approved ? <span className="rounded bg-critical/10 px-1 text-[10px] font-semibold text-critical">{t.authDesc}</span> : null}
                    </div>
                    {flagged ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.tells.map((tag) => (
                          <span key={tag} className="anat-pop rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: tint(TELL_META[tag].color, 0.12), color: TELL_META[tag].color }}>
                            {TELL_META[tag].label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right font-semibold tnum text-ink">{fmtCurrency(t.amount)}</div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="anat-rise mt-3 text-center text-xs text-ink-3" style={delay(6)}>
          Faded rows look ordinary. The highlighted ones each betray the true business — hover a tell to see why.
        </p>
      </div>
    </SceneShell>
  );
}

function DeviationScene({ fam }: { fam: AnatomyFamily }) {
  const devs = fam.deviations.slice(0, 5);
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          Each behaviour, measured against a normal merchant in the same category.
        </p>
        <div className="space-y-3">
          {devs.map((dv, i) => {
            const hasBase = dv.baseline != null && Math.abs(dv.baseline) > 1e-9;
            const max = hasBase ? Math.max(dv.value, dv.baseline as number) * 1.25 : 1;
            const valW = hasBase ? Math.min(100, (dv.value / max) * 100) : Math.min(100, (Math.abs(dv.z) / 5) * 100);
            const baseW = hasBase ? Math.min(100, ((dv.baseline as number) / max) * 100) : 0;
            const lowerWorse = dv.z < 0;
            const plain = dv.multiple != null && dv.multiple >= 1.3
              ? `${dv.multiple}× the ${dv.plainLabel} of a normal peer`
              : lowerWorse && dv.multiple != null
                ? `${dv.plainLabel} collapse to a fraction of normal`
                : `far outside the normal range (${dv.z >= 0 ? "+" : ""}${dv.z}σ)`;
            return (
              <div key={dv.key} className="anat-rise rounded-xl border border-border bg-surface px-4 py-3" style={delay(i + 1)}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{dv.label}</span>
                  <span className="text-sm font-bold tnum" style={{ color: dv.hot ? fam.color : "#475569" }}>{fmtDev(dv.value, dv.kind)}</span>
                </div>
                <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  {hasBase ? <div className="absolute inset-y-0 rounded-full" style={{ width: `${baseW}%`, backgroundColor: "#cbd5e1" }} /> : null}
                  <div className="anat-grow absolute inset-y-0 rounded-full" style={{ width: `${valW}%`, backgroundColor: dv.hot ? fam.color : "#94a3b8", ...delay(i + 1, 80) }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-ink-2">{plain}</span>
                  {hasBase ? <span className="text-ink-3">peer {dv.baselineLabel === "typical for the declared code" ? "code norm" : "median"}: {fmtDev(dv.baseline as number, dv.kind)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
}

/* ---- signature views (one distinct visual per family) --------------------- */
function FingerprintView({ s, accent }: { s: SigFingerprint; accent: string }) {
  const tierColor = (t: string) => t === "P1" ? PRIORITY_TIER_HEX.P1 : t === "P2" ? PRIORITY_TIER_HEX.P2 : t === "P3" ? PRIORITY_TIER_HEX.P3 : "#94a3b8";
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          The content classifier scores the merchant against every prohibited vertical. A real retailer
          resembles none — this one lights up <span className="font-bold" style={{ color: accent }}>{s.lit} at once</span>.
        </p>
        <div className="space-y-2">
          {s.entries.map((e, i) => (
            <div key={e.key} className="anat-rise flex items-center gap-3" style={delay(i + 1)}>
              <div className="w-36 shrink-0 text-right text-xs font-medium text-ink-2">{e.label}
                {e.tier !== "—" ? <span className="ml-1 rounded px-1 text-[9px] font-bold" style={{ backgroundColor: tint(tierColor(e.tier), 0.15), color: tierColor(e.tier) }}>{e.tier}</span> : null}
              </div>
              <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
                <div className="anat-grow h-full rounded-md" style={{ width: `${e.score}%`, backgroundColor: e.isTop ? accent : tint(tierColor(e.tier), 0.55), ...delay(i + 1, 70) }} />
              </div>
              <span className="w-9 text-right text-xs font-bold tnum" style={{ color: e.isTop ? accent : "#475569" }}>{Math.round(e.score)}</span>
            </div>
          ))}
        </div>
        <p className="anat-rise mt-4 text-center text-xs text-ink-3" style={delay(8)}>
          Concurrency is the signal: one business cannot legitimately behave like {s.lit} prohibited verticals simultaneously.
        </p>
      </div>
    </SceneShell>
  );
}

function InterchangeView({ s, accent, fam, run }: { s: SigInterchange; accent: string; fam: AnatomyFamily; run: number }) {
  const max = Math.max(s.expectedBps, s.effectiveBps, s.declaredBps) * 1.12;
  const leaked = useCountUp(s.leakedFeesUsd, run);
  const bars: [string, number, string][] = [
    ["Declared band", s.declaredBps, "#94a3b8"],
    ["Rate actually paid", s.effectiveBps, accent],
    ["Rate its behaviour warrants", s.expectedBps, "#e11d48"],
  ];
  const modelBlind = fam.score.integrityRiskScore < 60;
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          Interchange is the per-sale fee the merchant’s behaviour should command. Here the rate paid sits well
          below it — a few basis points, multiplied across every transaction.
        </p>
        <div className="space-y-3">
          {bars.map(([label, v, col], i) => (
            <div key={label} className="anat-rise" style={delay(i + 1)}>
              <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-ink-2">{label}</span><span className="font-bold tnum" style={{ color: col }}>{Math.round(v)} bps</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface-2">
                <div className="anat-grow h-full rounded-full" style={{ width: `${(v / max) * 100}%`, backgroundColor: col, ...delay(i + 1, 90) }} />
              </div>
            </div>
          ))}
        </div>
        <div className="anat-rise mt-5 grid gap-3 sm:grid-cols-3" style={delay(5)}>
          <StatTile label="Advantage taken" value={`${Math.round(s.advantageBps)} bps`} accent={accent} />
          <StatTile label="On volume of" value={fmtCurrency(s.grossUsd, true)} />
          <StatTile label="Fees leaked" value={fmtCurrency(leaked)} accent="#e11d48" hint="advantage × volume" />
        </div>
        {modelBlind ? (
          <div className="anat-rise mt-4 flex gap-2 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-xs text-ink-2" style={delay(6)}>
            <Icon name="AlertTriangle" size={15} className="mt-0.5 shrink-0 text-amber" />
            <span>Honest caveat: the learned model scored this merchant only <b>{fam.score.integrityRiskScore}</b> — “{fam.score.tier}”.
              The composite is effectively a miscoding detector and is <b>blind to interchange abuse</b>. A bright-line rule caught what the model missed.</span>
          </div>
        ) : null}
      </div>
    </SceneShell>
  );
}

function SplitView({ s, accent }: { s: SigSplit; accent: string }) {
  const top = s.bursts[0];
  const avg = top ? top.total / top.size : 0;
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-3xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          Each cluster is one purchase, rung as several charges on the same card moments apart — every fragment
          parked just under the <span className="font-semibold" style={{ color: accent }}>{fmtCurrency(s.ceiling)}</span> authorization ceiling.
        </p>
        <div className="anat-rise relative rounded-xl border border-border bg-surface px-4 pb-4 pt-8" style={delay(1)}>
          <div className="absolute inset-x-4 top-6 border-t-2 border-dashed border-critical" />
          <span className="absolute right-5 top-1.5 text-[10px] font-semibold text-critical">{fmtCurrency(s.ceiling)} ceiling</span>
          <div className="flex items-end justify-around gap-2" style={{ height: 150 }}>
            {s.bursts.map((b, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex items-end justify-center gap-1" style={{ height: 130 }}>
                  {b.amounts.map((a, j) => (
                    <div key={j} className="anat-grow-y w-3 rounded-t" title={fmtCurrency(a)}
                      style={{ height: `${Math.min(96, (a / s.ceiling) * 100)}%`, backgroundColor: accent, ...delay(i * 4 + j, 60) }} />
                  ))}
                </div>
                <span className="text-[10px] font-medium text-ink-3">{b.size}× ≈{fmtCurrency(b.total / b.size, true)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="anat-rise mt-4 grid gap-3 sm:grid-cols-3" style={delay(2)}>
          <StatTile label="Split-burst events" value={fmtNumber(s.burstEvents)} accent={accent} />
          <StatTile label="Charges seconds apart" value={`~${Math.round(s.avgGapSec)}s`} hint="mean gap within a burst" />
          <StatTile label="Sits near the ceiling" value={fmtPct(s.nearCeilingPct, 0)} />
        </div>
        {top ? (
          <p className="anat-rise mt-3 text-center text-xs text-ink-3" style={delay(3)}>
            The largest burst reassembles to <b>{fmtCurrency(top.total)}</b> — {top.size} charges of ≈{fmtCurrency(avg, true)} that,
            as one ticket, would have tripped a single-transaction review.
          </p>
        ) : null}
      </div>
    </SceneShell>
  );
}

function FactoringView({ s, accent }: { s: SigFactoring; accent: string }) {
  const R = 74, cx = 96, cy = 96;
  const maxVol = Math.max(...s.subs.map((x) => x.volume), 1);
  const pts = s.subs.map((sub, i) => {
    const ang = (-Math.PI / 2) + (i / Math.max(1, s.subs.length)) * Math.PI * 2;
    return { ...sub, x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R, r: 10 + (sub.volume / maxVol) * 12 };
  });
  const mv = s.monthly;
  const vmax = Math.max(...mv.map((m) => m.volume), 1);
  return (
    <SceneShell>
      <div className="mx-auto grid w-full max-w-3xl items-center gap-6 md:grid-cols-[auto_1fr]">
        <div>
          <svg width="192" height="192" viewBox="0 0 192 192" className="mx-auto" aria-hidden>
            {pts.map((p, i) => (
              <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} className="anat-draw" style={{ ["--len" as string]: R, ...delay(i, 90) }} stroke={tint(accent, 0.45)} strokeWidth="2" />
            ))}
            {pts.map((p, i) => (
              <g key={`n${i}`} className="anat-pop" style={delay(i + 1, 90)}>
                <circle cx={p.x} cy={p.y} r={p.r} fill={tint("#e11d48", 0.16)} stroke="#e11d48" strokeWidth="1.6" />
              </g>
            ))}
            <circle cx={cx} cy={cy} r="20" fill={tint(accent, 0.16)} stroke={accent} strokeWidth="2.5" />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={accent}>MID</text>
          </svg>
        </div>
        <div>
          <p className="anat-rise mb-3 text-sm text-ink-3" style={delay(0)}>
            One approved account, secretly settling for <span className="font-bold" style={{ color: accent }}>{s.nSub} undisclosed sub-merchants</span> —
            each an un-vetted business the bank never onboarded.
          </p>
          <div className="space-y-1.5">
            {s.subs.slice(0, 5).map((sub, i) => (
              <div key={sub.id} className="anat-rise flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs" style={delay(i + 1)}>
                <span className="font-mono text-[11px] text-ink-3">{sub.id}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{sub.descriptor}</span>
                <span className="font-semibold tnum text-ink">{fmtCurrency(sub.volume, true)}</span>
              </div>
            ))}
          </div>
          <div className="anat-rise mt-3 flex items-end justify-between gap-3" style={delay(6)}>
            <div>
              <div className="micro-label text-ink-3">Volume spike</div>
              <div className="text-lg font-bold tnum" style={{ color: accent }}>{s.spikeRatio}×</div>
            </div>
            <div className="flex h-10 items-end gap-0.5">
              {mv.map((m, i) => (
                <div key={i} className="anat-grow-y w-1.5 rounded-t" style={{ height: `${(m.volume / vmax) * 100}%`, backgroundColor: i === mv.length - 1 ? "#e11d48" : tint(accent, 0.5), ...delay(i, 40) }} title={m.month} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SceneShell>
  );
}

function DescriptorView({ s, accent }: { s: SigDescriptor; accent: string }) {
  const names = s.descriptors.slice(0, 6);
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-3xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          The billing name customers see keeps changing — <span className="font-bold" style={{ color: accent }}>{s.changes} times</span>,
          to words that share almost nothing, so no single name ever collects enough disputes to be monitored.
        </p>
        <div className="anat-rise flex flex-wrap items-center justify-center gap-2" style={delay(1)}>
          {names.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="anat-pop rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ ...delay(i, 90), borderColor: tint(accent, 0.4), backgroundColor: tint(accent, 0.07), color: "#0f172a" }}>
                {n.name}
              </span>
              {i < names.length - 1 ? <Icon name="ArrowRight" size={14} className="text-ink-3" /> : null}
            </div>
          ))}
        </div>
        {/* schematic sawtooth: how each rename resets dispute monitoring (illustrative, not measured) */}
        <div className="anat-rise mt-6 rounded-xl border border-border bg-surface p-4" style={delay(2)}>
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3"><span>Disputes per name (schematic)</span><span>monitoring threshold</span></div>
          <svg width="100%" height="70" viewBox="0 0 320 70" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="18" x2="320" y2="18" stroke="#e11d48" strokeWidth="1" strokeDasharray="4 3" />
            <path d="M0,64 L45,26 L46,64 L91,26 L92,64 L137,26 L138,64 L183,26 L184,64 L229,26 L230,64 L275,26 L276,64 L320,30"
              className="anat-draw" style={{ ["--len" as string]: 900 }} fill="none" stroke={accent} strokeWidth="2" />
          </svg>
          <p className="mt-1 text-center text-[11px] text-ink-3">Each rename drops disputes back to zero — the count never crosses the line.</p>
        </div>
        <div className="anat-rise mt-4 grid gap-3 sm:grid-cols-3" style={delay(3)}>
          <StatTile label="Name changes" value={fmtNumber(s.changes)} accent={accent} />
          <StatTile label="Word overlap between names" value={fmtPct(s.jaccard, 0)} hint="0% = deliberate, not a rebrand" />
          <StatTile label="Distinct names used" value={fmtNumber(s.distinct)} />
        </div>
      </div>
    </SceneShell>
  );
}

function CashView({ s, accent }: { s: SigCash; accent: string }) {
  const hmax = Math.max(...s.histogram.map((h) => h.count), 1);
  const rmax = Math.max(...s.roundHits.map((r) => r.count), 1);
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-3xl">
        <p className="anat-rise mb-4 text-center text-sm text-ink-3" style={delay(0)}>
          People withdraw cash in round numbers. A shop’s takings don’t cluster on exact hundreds — this book does,
          with big tickets and none of retail’s texture.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="anat-rise rounded-xl border border-border bg-surface p-4" style={delay(1)}>
            <div className="mb-2 text-[11px] font-semibold text-ink-3">Ticket-size distribution</div>
            <div className="flex items-end gap-1.5" style={{ height: 120 }}>
              {s.histogram.map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="anat-grow-y w-full rounded-t" style={{ height: `${(h.count / hmax) * 100}%`, backgroundColor: h.round ? accent : "#cbd5e1", ...delay(i, 50) }} />
                  <span className="text-[9px] text-ink-3">{h.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="anat-rise rounded-xl border border-border bg-surface p-4" style={delay(2)}>
            <div className="mb-2 text-[11px] font-semibold text-ink-3">Round-hundred “comb”</div>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {s.roundHits.map((r, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="anat-grow-y w-full rounded-t" style={{ height: `${(r.count / rmax) * 100}%`, backgroundColor: accent, ...delay(i, 50) }} title={`${fmtCurrency(r.amount)} × ${r.count}`} />
                  <span className="text-[9px] text-ink-3">{r.amount >= 1000 ? `${r.amount / 1000}k` : r.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="anat-rise mt-4 grid gap-3 sm:grid-cols-3" style={delay(3)}>
          <StatTile label="Sales on exact hundreds" value={fmtPct(s.roundShare, 0)} accent={accent} />
          <StatTile label="Average ticket" value={fmtCurrency(s.avgTicket)} hint="a retailer’s is far smaller" />
          <StatTile label="Charges over $500" value={fmtPct(s.gt500Share, 0)} />
        </div>
      </div>
    </SceneShell>
  );
}

function SignatureScene({ fam, run }: { fam: AnatomyFamily; run: number }) {
  const s = fam.signature;
  switch (s.kind) {
    case "fingerprint": return <FingerprintView s={s} accent={fam.color} />;
    case "interchange": return <InterchangeView s={s} accent={fam.color} fam={fam} run={run} />;
    case "split": return <SplitView s={s} accent={fam.color} />;
    case "factoring": return <FactoringView s={s} accent={fam.color} />;
    case "descriptor": return <DescriptorView s={s} accent={fam.color} />;
    case "cash": return <CashView s={s} accent={fam.color} />;
  }
}

function ScoreScene({ fam, run }: { fam: AnatomyFamily; run: number }) {
  const sc = fam.score;
  const showComposite = fam.key === "mcc_miscoding";
  const score = useCountUp(sc.integrityRiskScore, run);
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <div className="anat-pop mb-5 flex flex-wrap items-center justify-center gap-4 text-center" style={delay(0)}>
          <div>
            <div className="micro-label text-ink-3">Integrity risk score</div>
            <div className="text-4xl font-bold tnum" style={{ color: tierHex(sc.tier) }}>{score.toFixed(0)}</div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="space-y-1 text-left">
            <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ backgroundColor: tint(tierHex(sc.tier), 0.14), color: tierHex(sc.tier) }}>{sc.tier}</span>
            <div><RoutingChip by={sc.routedBy} /></div>
          </div>
        </div>

        {showComposite ? (
          <>
            <p className="anat-rise mb-3 text-center text-sm text-ink-3" style={delay(1)}>
              This merchant is <b>model-routed</b>: the learned composite assembles from weighted peer deviations.
            </p>
            <div className="space-y-2">
              {sc.drivers.map((dr, i) => (
                <div key={dr.key} className="anat-rise flex items-center gap-3" style={delay(i + 2)}>
                  <span className="w-40 shrink-0 text-right text-xs font-medium capitalize text-ink-2">{dr.label}</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-2">
                    <div className="anat-grow h-full rounded" style={{ width: `${dr.share}%`, backgroundColor: fam.color, ...delay(i + 2, 70) }} />
                  </div>
                  <span className="w-10 text-right text-xs font-semibold tnum text-ink-2">{dr.share}%</span>
                </div>
              ))}
            </div>
            <p className="anat-rise mt-3 text-center text-xs text-ink-3" style={delay(9)}>
              Weighted deviations sum to a composite z of <b>{sc.reconstructedZ}</b>, mapped through a logistic curve to the {sc.integrityRiskScore.toFixed(0)} above.
            </p>
          </>
        ) : sc.ruleChecks ? (
          <>
            <p className="anat-rise mb-3 text-center text-sm text-ink-3" style={delay(1)}>
              This merchant is <b>rule-routed</b> — the learned score alone would not have caught it. The
              <b> {sc.ruleChecks.ruleLabel}</b> rule fires when {sc.ruleChecks.mode === "all" ? "every" : "either"} clause holds:
            </p>
            <div className="space-y-2">
              {sc.ruleChecks.checks.map((c, i) => (
                <div key={c.col} className="anat-rise flex items-center gap-3 rounded-xl border px-4 py-3" style={{ ...delay(i + 2), borderColor: c.pass ? tint(fam.color, 0.35) : "#e3e8f0", backgroundColor: c.pass ? tint(fam.color, 0.05) : undefined }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: c.pass ? fam.color : "#e3e8f0", color: c.pass ? "#fff" : "#94a3b8" }}>
                    <Icon name={c.pass ? "Check" : "X"} size={13} />
                  </span>
                  <span className="flex-1 text-sm text-ink">{c.label}</span>
                  <span className="text-sm font-semibold tnum text-ink">
                    {fmtDev(c.actual, c.kind)} <span className="text-ink-3">{c.op} {fmtDev(c.threshold, c.kind)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="anat-rise mt-3 text-center text-xs text-ink-3" style={delay(9)}>
              Bright-line rules are how the five non-miscoding typologies are caught — the composite is tuned for miscoding and is blind to them.
            </p>
          </>
        ) : null}
      </div>
    </SceneShell>
  );
}

function VerdictScene({ fam, run }: { fam: AnatomyFamily; run: number }) {
  const v = fam.verdict;
  const e = fam.edu;
  const exposure = useCountUp(v.exposure, run);
  return (
    <SceneShell>
      <div className="mx-auto w-full max-w-2xl">
        <div className="anat-pop grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]" style={delay(0)}>
          <div className="rounded-2xl border border-ok/25 bg-ok/5 p-4 text-center">
            <div className="micro-label text-ok">Declared as</div>
            <div className="mt-1 text-sm font-bold text-ink">{v.declaredAs}</div>
            <div className="text-xs text-ink-3">MCC {v.declaredMcc}</div>
          </div>
          <div className="flex items-center justify-center"><Icon name="ArrowRight" size={22} style={{ color: fam.color }} /></div>
          <div className="rounded-2xl border p-4 text-center" style={{ borderColor: tint(fam.color, 0.3), backgroundColor: tint(fam.color, 0.06) }}>
            <div className="micro-label" style={{ color: fam.color }}>Behaves as</div>
            <div className="mt-1 text-sm font-bold text-ink">{v.behavesAs}</div>
            <div className="text-xs text-ink-3">{v.familyLabel}</div>
          </div>
        </div>

        <div className="anat-rise mt-4 grid gap-3 sm:grid-cols-3" style={delay(1)}>
          <StatTile label="Exposure at risk" value={fmtCurrency(exposure)} accent="#e11d48" />
          <StatTile label="Caught by" value={ROUTE_META[v.routedBy].label} hint={v.firingRule || undefined} />
          <StatTile label={fam.key === "mcc_miscoding" ? "Priority tier" : "Bright-line rules"} value={fam.key === "mcc_miscoding" ? v.priorityTier : fmtNumber(v.rulesTriggered)} />
        </div>

        <div className="anat-rise mt-4 space-y-3" style={delay(2)}>
          <TeachRow icon="TrendingDown" title={`Who loses money — ${e.victim}`} i={0}>{e.cost}</TeachRow>
          <TeachRow icon="ShieldCheck" title="How it differs from the legitimate version" i={0}>{e.legitTwin}</TeachRow>
        </div>

        {fam.rules.length ? (
          <div className="anat-rise mt-4 flex flex-wrap items-center justify-center gap-2" style={delay(3)}>
            <span className="text-[11px] text-ink-3">Rules tripped:</span>
            {fam.rules.map((r) => (
              <span key={r.name} title={r.plain} className="inline-flex cursor-help items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-2">
                <Icon name="CircleAlert" size={12} className="text-amber" />{r.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </SceneShell>
  );
}

function renderScene(key: SceneKey, fam: AnatomyFamily, run: number): JSX.Element {
  switch (key) {
    case "hero": return <HeroScene fam={fam} />;
    case "cover": return <CoverStoryScene fam={fam} />;
    case "stream": return <StreamScene fam={fam} />;
    case "deviation": return <DeviationScene fam={fam} />;
    case "signature": return <SignatureScene fam={fam} run={run} />;
    case "score": return <ScoreScene fam={fam} run={run} />;
    case "verdict": return <VerdictScene fam={fam} run={run} />;
  }
}

/* ---------------------------------------------------------------- home gallery */
function HomeGallery({ onPick, onTour }: { onPick: (i: number) => void; onTour: () => void }) {
  return (
    <div className="mx-auto max-w-5xl py-6">
      <div className="text-center">
        <div className="anat-pop mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan" style={delay(0)}>
          <Icon name="Fingerprint" size={24} />
        </div>
        <h1 className="anat-rise mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl" style={delay(1)}>The anatomy of six integrity typologies</h1>
        <p className="anat-rise mx-auto mt-2 max-w-2xl text-sm text-ink-2" style={delay(2)}>
          Six distinct ways a merchant misrepresents itself to a card network. Pick one to walk a real (synthetic)
          flagged case from clean cover story to verdict — or take the full tour.
        </p>
        <div className="anat-rise mt-4" style={delay(3)}>
          <Button variant="primary" onClick={onTour}>Tour all six <Icon name="ArrowRight" size={15} /></Button>
        </div>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {families.map((f, i) => (
          <button key={f.key} type="button" onClick={() => onPick(i)}
            className="group anat-rise flex flex-col rounded-2xl border border-border bg-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-card"
            style={{ ...delay(i + 4), borderTop: `3px solid ${f.color}` }}>
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: tint(f.color, 0.12), color: f.color }}>
                <Icon name={f.icon} size={22} />
              </span>
              <RoutingChip by={f.score.routedBy} />
            </div>
            <div className="mt-3 text-base font-bold text-ink">{f.label}</div>
            <div className="mt-1 flex-1 text-sm text-ink-2">{f.edu.tagline}</div>
            <div className="mt-3 flex items-center gap-1 text-xs font-semibold" style={{ color: f.color }}>
              See the anatomy <Icon name="ArrowRight" size={13} className="transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- explainer tray */
function ExplainerTray({ fam, open, onClose }: { fam: AnatomyFamily; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const e = fam.edu;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <div className="anat-rise relative h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6 shadow-xl" style={delay(0, 0)}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: tint(fam.color, 0.12), color: fam.color }}><Icon name={fam.icon} size={18} /></span>
            <div><div className="text-sm font-bold text-ink">{fam.label}</div><div className="text-[11px] text-ink-3">Quick explainer</div></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2"><Icon name="X" size={18} /></button>
        </div>
        <div className="mt-5 space-y-5 text-sm">
          <div><div className="micro-label text-ink-3">Definition</div><p className="mt-1 text-ink-2">{e.definition}</p></div>
          <div><div className="micro-label text-ink-3">Think of it as</div><p className="mt-1 text-ink-2">{e.analogy}</p></div>
          <div>
            <div className="micro-label text-ink-3">How it works</div>
            <ol className="mt-1 space-y-1.5">
              {e.mechanic.map((m, i) => (
                <li key={i} className="flex gap-2 text-ink-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ backgroundColor: tint(fam.color, 0.12), color: fam.color }}>{i + 1}</span>{m}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="micro-label text-ink-3">Red flags</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {fam.tells.map((t) => (
                <span key={t.tag} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: tint(TELL_META[t.tag].color, 0.1), color: TELL_META[t.tag].color }}>{TELL_META[t.tag].label}</span>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-surface-2 p-3"><div className="micro-label text-ink-3">Glossary</div>
            <dl className="mt-1.5 space-y-1.5">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="text-[12px]"><dt className="inline font-semibold text-ink">{g.term}</dt><dd className="inline text-ink-3"> — {g.def}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- deck shell */
export default function AnatomyDeck() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  // Deep-link: /anatomy?family=<key> jumps straight into that chapter (used by the Typology Hub).
  const deepFam = params.get("family");
  const deepIdx = deepFam ? families.findIndex((f) => f.key === deepFam) : -1;
  const [view, setView] = useState<"home" | "deck">(deepIdx >= 0 ? "deck" : "home");
  const [famIdx, setFamIdx] = useState(deepIdx >= 0 ? deepIdx : 0);
  const [scene, setScene] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [tray, setTray] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const fam = families[famIdx];
  const lastScene = SCENE_KEYS.length - 1;
  const lastFam = families.length - 1;

  const bump = useCallback(() => { setPulse((p) => p + 1); if (stageRef.current) stageRef.current.scrollTop = 0; }, []);
  const goScene = useCallback((n: number) => { setScene(() => { const c = Math.max(0, Math.min(lastScene, n)); bump(); return c; }); }, [lastScene, bump]);
  const goFam = useCallback((i: number, s = 0) => { setFamIdx(Math.max(0, Math.min(lastFam, i))); setScene(s); bump(); }, [lastFam, bump]);

  const next = useCallback(() => {
    if (scene < lastScene) goScene(scene + 1);
    else if (famIdx < lastFam) goFam(famIdx + 1, 0);
  }, [scene, lastScene, famIdx, lastFam, goScene, goFam]);
  const prev = useCallback(() => {
    if (scene > 0) goScene(scene - 1);
    else if (famIdx > 0) goFam(famIdx - 1, lastScene);
    else setView("home");
  }, [scene, famIdx, lastScene, goScene, goFam]);

  useEffect(() => {
    if (view !== "deck") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const k = e.key;
      if ((k === " " || k === "Enter") && (tag === "BUTTON" || tag === "A")) return;
      if (k === "?" || k === "i") { e.preventDefault(); setTray((t) => !t); return; }
      if (k === "Escape") { e.preventDefault(); if (tray) setTray(false); else setView("home"); return; }
      if (k === "Tab") { e.preventDefault(); goFam(e.shiftKey ? famIdx - 1 : famIdx + 1, 0); return; }
      if ([" ", "ArrowRight", "ArrowDown", "PageDown", "Enter"].includes(k)) { e.preventDefault(); next(); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); prev(); }
      else if (k === "Home") { e.preventDefault(); goScene(0); }
      else if (k === "End") { e.preventDefault(); goScene(lastScene); }
      else if (/^[1-6]$/.test(k)) { e.preventDefault(); goFam(Number(k) - 1, 0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, tray, famIdx, next, prev, goFam, goScene, lastScene]);

  if (view === "home") {
    return <HomeGallery onPick={(i) => { setFamIdx(i); setScene(0); setPulse((p) => p + 1); setView("deck"); }} onTour={() => { setFamIdx(0); setScene(0); setPulse((p) => p + 1); setView("deck"); }} />;
  }

  const key = SCENE_KEYS[scene];
  const atEnd = famIdx === lastFam && scene === lastScene;

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      {/* family tabs (chapters) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => setView("home")} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-3 hover:bg-surface-2" title="All typologies">
          <Icon name="LayoutDashboard" size={14} /> All
        </button>
        <span className="text-ink-3">·</span>
        {families.map((f, i) => (
          <button key={f.key} type="button" onClick={() => goFam(i, 0)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={i === famIdx ? { backgroundColor: tint(f.color, 0.12), color: f.color } : { color: "#64748b" }}>
            <Icon name={f.icon} size={14} /> {f.label}
          </button>
        ))}
      </div>

      {/* chrome: scene identity + progress */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: tint(fam.color, 0.12), color: fam.color }}><Icon name={fam.icon} size={18} /></span>
          <div>
            <div className="micro-label" style={{ color: fam.color }}>{fam.label} · typology {famIdx + 1} of {families.length}</div>
            <div className="text-sm font-bold text-ink">{sceneTitle(key, fam)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setTray(true)} className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2" title="Explain this typology (press ? )">
            <Icon name="Info" size={14} /> Explain
          </button>
          <div className="hidden items-center gap-1.5 sm:flex">
            {SCENE_KEYS.map((sk, i) => (
              <button key={sk} type="button" aria-label={sceneTitle(sk, fam)} title={sceneTitle(sk, fam)} onClick={() => goScene(i)}
                className="h-2 rounded-full transition-all" style={{ width: i === scene ? 22 : 8, backgroundColor: i === scene ? fam.color : i < scene ? tint(fam.color, 0.4) : "#dbe2ec" }} />
            ))}
          </div>
        </div>
      </div>

      {/* stage */}
      <div className="relative mt-3 flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `radial-gradient(700px 400px at 100% 0%, ${tint(fam.color, 0.05)}, transparent 60%)` }} />
        <div ref={stageRef} key={`${famIdx}-${scene}-${pulse}`} className="relative h-full overflow-y-auto px-5 py-6 sm:px-8">
          {renderScene(key, fam, pulse)}
        </div>
      </div>

      {/* footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="hidden items-center gap-1 text-[11px] text-ink-3 md:flex">
          <Kbd>Space</Kbd> next · <Kbd>←</Kbd> back · <Kbd>Tab</Kbd> next typology · <Kbd>1–6</Kbd> jump · <Kbd>?</Kbd> explain
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={prev}><Icon name="ArrowLeft" size={15} /> Back</Button>
          {!atEnd ? (
            <Button variant="primary" onClick={next}>
              {scene === lastScene ? "Next typology" : "Next"} <Icon name="ArrowRight" size={15} />
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setView("home")}><Icon name="RotateCcw" size={15} /> All typologies</Button>
              <Button variant="primary" onClick={() => nav(fam.route)}>Open studio <Icon name="ArrowRight" size={15} /></Button>
            </>
          )}
        </div>
      </div>

      <ExplainerTray fam={fam} open={tray} onClose={() => setTray(false)} />
    </div>
  );
}
