import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, Button, Chip, TierBadge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtCurrency, fmtCompact, fmtNumber, fmtPct } from "@/utils/format";
import { FAMILY_META, TIER_HEX, type OverviewTier } from "@/data/overview";
import { loadMerchants, SAMPLE_QUERIES, type ExplorerMerchant } from "@/features/explorer/types";
import { loadTxnPreview, humanizeColumn, type TxnPreview, type PreviewValue } from "@/features/explorer/preview";
import type { QueryResult, TableSchema } from "@/features/explorer/duckdb";
import { useAppStore } from "@/stores/appStore";
import { TIER_COLOR } from "@/features/cases/actions";
import { TYPOLOGY_LABELS, type Typology, type RiskTier } from "@/types/domain";
import { mccLabel } from "@/data/mccTaxonomy";
import { exportCsv } from "@/utils/exports";

type Svc = typeof import("@/features/explorer/duckdb");
type SortKey =
  | "exposure_weighted_score" | "integrity_risk_score" | "gross_sales_usd"
  | "pct_cnp" | "chargeback_rate_bps" | "txn_count" | "interchange_advantage_bps";

const FAMILY_OPTS: { key: string; label: string }[] = [
  { key: "all", label: "All families" },
  { key: "mcc_miscoding", label: "MCC Miscoding" },
  { key: "mcc_abuse", label: "MCC Abuse" },
  { key: "split_ticketing", label: "Split Ticketing" },
  { key: "factoring", label: "Factoring" },
  { key: "descriptor", label: "Descriptor" },
  { key: "cash", label: "Cash" },
];
const TIER_OPTS: (OverviewTier | "all")[] = ["all", "Critical", "High", "Elevated", "Monitor", "Low"];

function familyColor(key: string): string {
  return (FAMILY_META as Record<string, { color: string }>)[key]?.color ?? "#94a3b8";
}

function FamilyChip({ mkey, label }: { mkey: string; label: string }) {
  if (!label) return <span className="text-ink-3">—</span>;
  const color = familyColor(mkey);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ color, background: `${color}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function ScoreChip({ score, tier }: { score: number; tier: OverviewTier }) {
  return (
    <span
      className="grid h-7 w-8 place-items-center rounded-md text-[12.5px] font-bold text-white tnum"
      style={{ background: TIER_HEX[tier] }}
    >
      {Math.round(score)}
    </span>
  );
}

/* ─────────────────────────── Browse mode ─────────────────────────── */

function BrowseMode({ onExploreTxns }: { onExploreTxns: (m: ExplorerMerchant) => void }) {
  const [merchants, setMerchants] = useState<ExplorerMerchant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fam, setFam] = useState<string>("all");
  const [tier, setTier] = useState<OverviewTier | "all">("all");
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "exposure_weighted_score",
    dir: "desc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadMerchants().then(setMerchants).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const rows = useMemo(() => {
    if (!merchants) return [];
    const needle = q.trim().toLowerCase();
    const out = merchants.filter((m) => {
      if (flaggedOnly && m.flag_for_investigation !== 1) return false;
      if (fam !== "all" && m.family !== fam) return false;
      if (tier !== "all" && m.risk_tier !== tier) return false;
      if (needle) {
        const hay = `${m.merchant_name} ${m.merchant_id} ${m.corp_name} ${m.merchant_city} ${m.mcc_group} ${m.declared_mcc}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => ((a[sort.key] as number) - (b[sort.key] as number)) * dir);
    return out;
  }, [merchants, q, fam, tier, flaggedOnly, sort]);

  const selected = useMemo(
    () => (selectedId ? merchants?.find((m) => m.merchant_id === selectedId) ?? null : null),
    [selectedId, merchants],
  );

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  if (err) {
    return (
      <Card className="p-8 text-center text-sm text-ink-2">
        Could not load the merchant table. <span className="text-ink-3">{err}</span>
      </Card>
    );
  }
  if (!merchants) {
    return <div className="py-16 text-center text-sm text-ink-3">Loading merchant table…</div>;
  }

  const SortHead = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 ${right ? "justify-end" : ""} ${sort.key === k ? "text-ink" : "text-ink-3"}`}
    >
      {right ? null : label}
      <Icon name={sort.key === k && sort.dir === "asc" ? "TrendingUp" : "TrendingDown"} size={11} className={sort.key === k ? "opacity-100" : "opacity-0"} />
      {right ? label : null}
    </button>
  );

  return (
    <div>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ID, corp, city, MCC…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none placeholder:text-ink-3 focus:border-cyan/50"
          />
        </div>
        <select value={fam} onChange={(e) => setFam(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-cyan/50">
          {FAMILY_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value as OverviewTier | "all")} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-cyan/50">
          {TIER_OPTS.map((t) => <option key={t} value={t}>{t === "all" ? "All tiers" : t}</option>)}
        </select>
        <button
          onClick={() => setFlaggedOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${flaggedOnly ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-border bg-surface text-ink-2"}`}
        >
          <Icon name={flaggedOnly ? "Check" : "Filter"} size={14} /> Flagged only
        </button>
      </div>

      <div className="mt-2 text-[11px] text-ink-3 tnum">
        {fmtNumber(rows.length)} merchants{" "}
        {flaggedOnly ? "flagged" : "in portfolio"}
        {q || fam !== "all" || tier !== "all" ? " · filtered" : ""}
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* table */}
        <Card className="overflow-hidden">
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] font-bold uppercase tracking-wide text-ink-3">
                <tr className="border-b border-border">
                  <th className="px-3 py-2.5 text-left">Merchant</th>
                  <th className="px-2 py-2.5 text-left">Family</th>
                  <th className="px-2 py-2.5 text-left"><SortHead label="Risk" k="integrity_risk_score" /></th>
                  <th className="px-2 py-2.5 text-right"><SortHead label="Exposure" k="gross_sales_usd" right /></th>
                  <th className="hidden px-2 py-2.5 text-right md:table-cell"><SortHead label="CNP" k="pct_cnp" right /></th>
                  <th className="hidden px-3 py-2.5 text-right md:table-cell"><SortHead label="CB bps" k="chargeback_rate_bps" right /></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((m) => (
                  <tr
                    key={m.merchant_id}
                    onClick={() => setSelectedId(m.merchant_id)}
                    className={`cursor-pointer border-b border-border-soft last:border-b-0 hover:bg-surface-2/60 ${selectedId === m.merchant_id ? "bg-cyan/5" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="max-w-[240px] truncate font-semibold text-ink">{m.merchant_name}</div>
                      <div className="truncate text-[10.5px] text-ink-3">
                        <span className="font-mono">{m.merchant_id}</span> · {m.merchant_city}, {m.merchant_country}
                      </div>
                    </td>
                    <td className="px-2 py-2"><FamilyChip mkey={m.family} label={m.family_label} /></td>
                    <td className="px-2 py-2"><ScoreChip score={m.integrity_risk_score} tier={m.risk_tier} /></td>
                    <td className="px-2 py-2 text-right font-semibold tnum">{fmtCurrency(m.gross_sales_usd, true)}</td>
                    <td className="hidden px-2 py-2 text-right text-ink-2 tnum md:table-cell">{fmtPct(m.pct_cnp)}</td>
                    <td className="hidden px-3 py-2 text-right text-ink-2 tnum md:table-cell">{Math.round(m.chargeback_rate_bps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 ? (
              <div className="border-t border-border bg-surface-2/50 px-3 py-2 text-center text-[11px] text-ink-3">
                Showing first 400 of {fmtNumber(rows.length)} — refine filters or use the SQL console for the full set.
              </div>
            ) : null}
          </div>
        </Card>

        {/* detail */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <MerchantDetail m={selected} onExploreTxns={onExploreTxns} onClose={() => setSelectedId(null)} />
          ) : (
            <Card className="flex h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="Fingerprint" size={26} className="text-ink-3" />
              <div className="text-sm font-semibold text-ink-2">Select a merchant</div>
              <div className="max-w-[24ch] text-xs text-ink-3">
                Every figure is a model output over synthetic settlement data.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-2">
      <div className="text-[9.5px] font-bold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-[13px] font-bold tnum">{value}</div>
    </div>
  );
}

function MerchantDetail({
  m, onExploreTxns, onClose,
}: {
  m: ExplorerMerchant;
  onExploreTxns: (m: ExplorerMerchant) => void;
  onClose: () => void;
}) {
  const rules = (m.rule_names || "").split("|").filter(Boolean);
  const labelColor =
    m.label === "clean" ? TIER_HEX.Low : m.label === "interchange_abuse" ? "#7c3aed" : TIER_HEX.High;
  return (
    <Card className="overflow-hidden">
      <div className="relative border-b border-border p-4" style={{ background: `${familyColor(m.family)}0a` }}>
        <button onClick={onClose} className="absolute right-3 top-3 text-ink-3 hover:text-ink"><Icon name="X" size={16} /></button>
        <div className="pr-6 text-[15px] font-bold tracking-tight">{m.merchant_name}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">
          <span className="font-mono">{m.merchant_id}</span> · {m.corp_name}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FamilyChip mkey={m.family} label={m.family_label || "Not flagged"} />
          {m.subtype ? <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] text-ink-2">{m.subtype}</span> : null}
          <span className="ml-auto grid h-8 w-9 place-items-center rounded-md text-[13px] font-bold text-white tnum" style={{ background: TIER_HEX[m.risk_tier] }}>
            {Math.round(m.integrity_risk_score)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Declared MCC" value={String(m.declared_mcc)} />
          <Metric label="Txns" value={fmtCompact(m.txn_count)} />
          <Metric label="Cards" value={fmtCompact(m.unique_cards)} />
          <Metric label="Gross sales" value={fmtCurrency(m.gross_sales_usd, true)} />
          <Metric label="Avg ticket" value={fmtCurrency(m.avg_ticket_usd)} />
          <Metric label="Percentile" value={fmtPct(m.integrity_percentile / 100)} />
          <Metric label="CNP" value={fmtPct(m.pct_cnp)} />
          <Metric label="Recurring" value={fmtPct(m.pct_recurring)} />
          <Metric label="Cross-border" value={fmtPct(m.pct_cross_border)} />
          <Metric label="Quasi-cash" value={fmtPct(m.pct_quasi_cash)} />
          <Metric label="Round-$100" value={fmtPct(m.pct_round_100)} />
          <Metric label="CB rate" value={`${Math.round(m.chargeback_rate_bps)} bps`} />
          <Metric label="Eff. interchange" value={`${Math.round(m.effective_interchange_bps)} bps`} />
          <Metric label="IC advantage" value={`${Math.round(m.interchange_advantage_bps)} bps`} />
          <Metric label="Descriptors" value={fmtNumber(m.n_distinct_descriptors)} />
        </div>

        <div className="mt-3 text-[9.5px] font-bold uppercase tracking-wide text-ink-3">MCC group</div>
        <div className="text-[12px] text-ink-2">{m.mcc_group}</div>

        {m.flag_reason ? (
          <>
            <div className="mt-3 text-[9.5px] font-bold uppercase tracking-wide text-ink-3">Flag reason</div>
            <div className="text-[12px] text-ink-2">{m.flag_reason}</div>
          </>
        ) : null}

        {rules.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {rules.map((r) => (
              <span key={r} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{r}</span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2 border-t border-border-soft pt-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Synthetic label</span>
          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white" style={{ background: labelColor }}>
            {m.label.replace("_", " ")}
          </span>
          <Button variant="ghost" className="ml-auto px-2.5 py-1.5 text-[12px]" onClick={() => onExploreTxns(m)}>
            <Icon name="ScanSearch" size={13} /> Transactions
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────── Preview mode ─────────────────────────── */

// Curated aggregate columns — enough to convey "one merchant = one scored row".
const MERCH_PREVIEW_COLS = [
  "merchant_id", "merchant_name", "merchant_country", "declared_mcc", "mcc_group",
  "txn_count", "unique_cards", "gross_sales_usd", "avg_ticket_usd", "pct_cnp",
  "pct_recurring", "pct_cross_border", "chargeback_rate_bps", "effective_interchange_bps",
  "interchange_advantage_bps", "integrity_risk_score", "risk_tier", "family_label",
];
const MERCH_PREVIEW_ROWS = 40;

function fmtFlag(v: PreviewValue): { text: string; hot: boolean } {
  const s = String(v ?? "").toUpperCase();
  return { text: s === "Y" ? "Yes" : s === "N" ? "No" : s || "—", hot: s === "Y" };
}

function previewCell(col: string, v: PreviewValue): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (col.endsWith("_usd")) return fmtCurrency(v, col === "gross_sales_usd");
    if (col.startsWith("pct_")) return fmtPct(v);
    if (col.endsWith("_bps")) return `${Math.round(v)} bps`;
    if (col === "integrity_risk_score") return String(Math.round(v));
    return Number.isInteger(v) ? fmtNumber(v) : v.toFixed(2);
  }
  return String(v);
}

// Column types that get bespoke rendering (chips / flag pills) instead of plain text.
const FLAG_COLS = new Set(["approved_flag", "chargeback_flag", "recurring_flag", "card_present_flag"]);

function PreviewTable({
  columns, rows, rowAccent, familyOf,
}: {
  columns: string[];
  rows: Record<string, PreviewValue>[];
  rowAccent?: (row: Record<string, PreviewValue>) => string | null;
  familyOf?: (row: Record<string, PreviewValue>) => { key: string; label: string } | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface-2 text-[9.5px] font-bold uppercase tracking-wide text-ink-3">
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th key={c} className={`whitespace-nowrap px-3 py-2 ${/_usd$|^pct_|_bps$|score$|count$|^declared_mcc$|cards$|^local_hour$/.test(c) ? "text-right" : "text-left"}`}>
                  {humanizeColumn(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const accent = rowAccent?.(r) ?? null;
              return (
                <tr key={i} className="border-b border-border-soft last:border-b-0 hover:bg-surface-2/50">
                  {columns.map((c, j) => {
                    const v = r[c];
                    const right = /_usd$|^pct_|_bps$|score$|count$|^declared_mcc$|cards$|^local_hour$/.test(c);
                    // family label chip
                    if (c === "family_label") {
                      const fk = familyOf?.(r);
                      return <td key={c} className="whitespace-nowrap px-3 py-1.5"><FamilyChip mkey={fk?.key ?? ""} label={String(v || "")} /></td>;
                    }
                    if (c === "risk_tier") {
                      const tier = String(v) as OverviewTier;
                      return (
                        <td key={c} className="whitespace-nowrap px-3 py-1.5">
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: TIER_HEX[tier] ?? "#94a3b8" }}>{String(v)}</span>
                        </td>
                      );
                    }
                    if (FLAG_COLS.has(c)) {
                      const f = fmtFlag(v);
                      const hot = c === "approved_flag" ? !f.hot : f.hot; // declined / chargeback / recurring / CNP = notable
                      return (
                        <td key={c} className="whitespace-nowrap px-3 py-1.5">
                          <span className={`font-medium ${hot ? "text-high" : "text-ink-3"}`}>{f.text}</span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={c}
                        className={`whitespace-nowrap px-3 py-1.5 tnum ${right ? "text-right" : ""} ${c.includes("merchant_name") ? "font-semibold text-ink" : "text-ink-2"} ${c.endsWith("_id") || c === "pan_masked" || c === "merchant_descriptor" ? "font-mono text-[11px] text-ink-3" : ""}`}
                        style={j === 0 && accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
                      >
                        {previewCell(c, v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SchemaStrip({ shown, total, rowsShown, rowsTotal, unit }: {
  shown: number; total: number; rowsShown: number; rowsTotal: number; unit: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3 tnum">
      <span><span className="font-bold text-ink-2">{shown}</span> of {total} columns</span>
      <span className="text-border">·</span>
      <span><span className="font-bold text-ink-2">{fmtNumber(rowsShown)}</span> sample {unit}</span>
      <span className="text-border">·</span>
      <span>full slice <span className="font-bold text-ink-2">{fmtNumber(rowsTotal)}</span> {unit}</span>
    </div>
  );
}

function PreviewMode({ onQuery }: { onQuery: (sql: string) => void }) {
  const [ds, setDs] = useState<"transactions" | "merchants">("transactions");
  const [txn, setTxn] = useState<TxnPreview | null>(null);
  const [merch, setMerch] = useState<ExplorerMerchant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadTxnPreview().then(setTxn).catch((e) => setErr(String(e?.message ?? e)));
    loadMerchants().then(setMerch).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  // merchant_id → typology family, so transaction rows inherit a typology accent.
  const famByMid = useMemo(() => {
    const m = new Map<string, { key: string; label: string }>();
    merch?.forEach((r) => m.set(r.merchant_id, { key: r.family, label: r.family_label }));
    return m;
  }, [merch]);

  const merchRows = useMemo(() => {
    if (!merch) return [];
    // flagged first, by exposure — the interesting rows lead the preview.
    const sorted = [...merch].sort(
      (a, b) => b.flag_for_investigation - a.flag_for_investigation || b.exposure_weighted_score - a.exposure_weighted_score,
    );
    return sorted.slice(0, MERCH_PREVIEW_ROWS) as unknown as Record<string, PreviewValue>[];
  }, [merch]);

  const DS: { key: "transactions" | "merchants"; label: string; icon: string; blurb: string }[] = [
    { key: "transactions", label: "Transaction level", icon: "Receipt", blurb: "One row per settled card transaction — the raw ledger the models read." },
    { key: "merchants", label: "Merchant aggregates", icon: "Building2", blurb: "One row per merchant — behavioural features rolled up and scored." },
  ];

  if (err) {
    return <Card className="p-8 text-center text-sm text-ink-2">Could not load preview data. <span className="text-ink-3">{err}</span></Card>;
  }

  const merchColsTotal = merch && merch[0] ? Object.keys(merch[0]).length : MERCH_PREVIEW_COLS.length;

  return (
    <div>
      {/* dataset switch */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {DS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDs(d.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${d.key !== "transactions" ? "border-l border-border" : ""} ${ds === d.key ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name={d.icon} size={14} /> {d.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => onQuery(ds === "transactions" ? "SELECT *\nFROM transactions\nLIMIT 100;" : "SELECT *\nFROM merchants\nLIMIT 100;")}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:border-cyan/40 hover:text-cyan"
        >
          <Icon name="Command" size={13} /> Open in SQL console
        </button>
      </div>

      <p className="mt-2 max-w-[70ch] text-[12px] text-ink-2">{DS.find((d) => d.key === ds)!.blurb}</p>

      {ds === "transactions" ? (
        !txn ? (
          <div className="py-16 text-center text-sm text-ink-3">Loading transaction sample…</div>
        ) : (
          <div className="mt-3">
            <SchemaStrip
              shown={txn.meta.previewColumns.length}
              total={txn.meta.totalColumnsInSlice}
              rowsShown={txn.meta.previewRows}
              rowsTotal={txn.meta.totalRowsInSlice}
              unit="transactions"
            />
            <div className="mt-1 mb-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-3">
              <span className="font-semibold uppercase tracking-wide">Sampled across</span>
              {txn.meta.merchants.map((m) => (
                <span key={m.merchant_id} className="rounded-full border border-border bg-surface-2 px-2 py-0.5">{m.family}</span>
              ))}
            </div>
            <PreviewTable
              columns={txn.meta.previewColumns}
              rows={txn.rows}
              rowAccent={(r) => {
                const f = famByMid.get(String(r.merchant_id));
                return f ? familyColor(f.key) : "#cbd5e1";
              }}
            />
          </div>
        )
      ) : !merch ? (
        <div className="py-16 text-center text-sm text-ink-3">Loading merchant aggregates…</div>
      ) : (
        <div className="mt-3">
          <SchemaStrip
            shown={MERCH_PREVIEW_COLS.length}
            total={merchColsTotal}
            rowsShown={merchRows.length}
            rowsTotal={merch.length}
            unit="merchants"
          />
          <div className="mt-2">
            <PreviewTable
              columns={MERCH_PREVIEW_COLS}
              rows={merchRows}
              familyOf={(r) => ({ key: String(r.family ?? ""), label: String(r.family_label ?? "") })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── SQL console mode ─────────────────────────── */

function SqlMode({
  svcRef, sql, setSql, autoRunToken,
}: {
  svcRef: MutableRefObject<Svc | null>;
  sql: string;
  setSql: (s: string) => void;
  autoRunToken: number;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [initErr, setInitErr] = useState<string | null>(null);
  const [schema, setSchema] = useState<TableSchema[] | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const svc = svcRef.current ?? (await import("@/features/explorer/duckdb"));
        svcRef.current = svc;
        await svc.ensureDb();
        const sch = await svc.loadSchema();
        if (!alive) return;
        setSchema(sch);
        setState("ready");
      } catch (e) {
        if (!alive) return;
        setInitErr(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
    return () => { alive = false; };
  }, [svcRef]);

  async function run() {
    const svc = svcRef.current;
    if (!svc || state !== "ready") return;
    setRunning(true);
    setRunErr(null);
    try {
      setResult(await svc.runQuery(sql));
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  // Auto-run once the engine is ready when a hand-off from Browse bumps the token.
  const lastToken = useRef(0);
  useEffect(() => {
    if (state === "ready" && autoRunToken > 0 && autoRunToken !== lastToken.current) {
      lastToken.current = autoRunToken;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, autoRunToken]);

  if (state === "error") {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Icon name="AlertTriangle" size={20} className="mt-0.5 shrink-0 text-amber" />
          <div>
            <div className="text-sm font-semibold text-ink">SQL engine could not load</div>
            <p className="mt-1 max-w-[60ch] text-xs text-ink-2">
              The in-browser DuckDB engine is fetched from a public CDN on first use. It looks like that
              request was blocked. The <span className="font-semibold">Browse</span> tab works fully offline;
              the SQL console needs one-time network access to load the WASM runtime.
            </p>
            <div className="mt-2 font-mono text-[11px] text-ink-3">{initErr}</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* schema sidebar */}
      <Card className="hidden overflow-hidden lg:block">
        <div className="border-b border-border bg-surface-2 px-3 py-2">
          <SectionLabel>Tables</SectionLabel>
        </div>
        <div className="max-h-[560px] overflow-auto p-2">
          {state === "loading" ? (
            <div className="px-1 py-2 text-[11px] text-ink-3">Loading schema…</div>
          ) : (
            schema?.map((t) => (
              <div key={t.name} className="mb-3">
                <button
                  onClick={() => setSql(`SELECT *\nFROM ${t.name}\nLIMIT 100;`)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-bold text-ink hover:bg-surface-2"
                >
                  <Icon name="Layers" size={13} className="text-cyan" /> {t.name}
                  <span className="ml-auto text-[10px] font-normal text-ink-3">{t.columns.length}</span>
                </button>
                <div className="mt-0.5 space-y-0.5">
                  {t.columns.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => setSql(`${sql}${sql.endsWith(" ") || sql.endsWith("\n") ? "" : " "}${c.name}`)}
                      title={c.type}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left font-mono text-[10.5px] text-ink-3 hover:bg-surface-2 hover:text-ink-2"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto shrink-0 text-[9px] uppercase opacity-60">{c.type.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* editor + results */}
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SAMPLE_QUERIES.map((s) => (
            <button
              key={s.label}
              onClick={() => setSql(s.sql)}
              className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-cyan/40 hover:text-cyan"
            >
              {s.label}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void run(); }
            }}
            spellCheck={false}
            rows={7}
            className="w-full resize-y border-0 bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none"
          />
          <div className="flex items-center gap-3 border-t border-border bg-surface-2/50 px-3 py-2">
            <Button variant="primary" onClick={() => void run()} disabled={state !== "ready" || running} className="px-3 py-1.5 text-[12.5px]">
              <Icon name="Play" size={13} /> {running ? "Running…" : "Run"}
            </Button>
            <span className="text-[11px] text-ink-3">
              {state === "loading" ? "Loading engine…" : "⌘/Ctrl + Enter"}
            </span>
            {result ? (
              <span className="ml-auto text-[11px] text-ink-3 tnum">
                {fmtNumber(result.rowCount)} rows · {result.elapsedMs.toFixed(0)} ms
                {result.truncated ? " · showing 2,000" : ""}
              </span>
            ) : null}
          </div>
        </Card>

        {runErr ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-high/30 bg-high/5 px-3 py-2.5 text-[12px] text-high">
            <Icon name="CircleAlert" size={15} className="mt-0.5 shrink-0" />
            <span className="font-mono">{runErr}</span>
          </div>
        ) : null}

        {result ? (
          <Card className="mt-3 overflow-hidden">
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-10 bg-surface-2 text-[10px] font-bold uppercase tracking-wide text-ink-3">
                  <tr className="border-b border-border">
                    {result.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2 text-left">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border-soft last:border-b-0 hover:bg-surface-2/50">
                      {r.map((v, j) => (
                        <td key={j} className="whitespace-nowrap px-3 py-1.5 tnum">{renderCell(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-ink-3">Query returned no rows.</div>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function renderCell(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "number") return Number.isInteger(v) ? fmtNumber(v) : v.toFixed(2);
  return String(v);
}

/* ─────────────────────────── Risk-table mode ─────────────────────────── */
// Folded in from the former Merchant Universe tab. Distinct from Browse: it reads
// the live scored records in the store (not the DuckDB merchant slice), leads with
// declared→predicted MCC divergence, and drills into the investigation workspace.

type RiskSortKey = "risk" | "volume" | "divergence" | "txns";
const RT_TYPOS: (Typology | "ALL")[] = ["ALL", "MCC_MISCODING", "SPLIT_TICKETING", "FACTORING", "FAKE_DESCRIPTOR", "CASH_DISBURSEMENT", "CLEAN"];
const RT_TIERS: (RiskTier | "ALL")[] = ["ALL", "critical", "high", "elevated", "watch", "clear"];

function RiskTableMode() {
  const records = useAppStore((s) => s.result!.records);
  const selectMerchant = useAppStore((s) => s.selectMerchant);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [typo, setTypo] = useState<Typology | "ALL">("ALL");
  const [tier, setTier] = useState<RiskTier | "ALL">("ALL");
  const [sort, setSort] = useState<RiskSortKey>("risk");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = records.filter((r) => {
      if (typo !== "ALL" && r.primaryTypology !== typo) return false;
      if (tier !== "ALL" && r.scores.tier !== tier) return false;
      if (q && !(`${r.merchant.tradeName} ${r.merchant.legalName} ${r.merchant.merchantId} ${r.merchant.descriptor}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const key = (r: (typeof records)[number]) =>
      sort === "risk" ? r.scores.finalRiskScore
      : sort === "volume" ? r.features.totalVolume
      : sort === "divergence" ? r.features.mccDivergence
      : r.features.txnCount;
    return rows.sort((a, b) => key(b) - key(a));
  }, [records, query, typo, tier, sort]);

  const shown = filtered.slice(0, 120);

  const doExport = () =>
    exportCsv(
      "merchant-risk-table.csv",
      filtered.slice(0, 500).map((r) => ({
        merchantId: r.merchant.merchantId,
        tradeName: r.merchant.tradeName,
        declaredMcc: r.merchant.declaredMcc,
        predictedMcc: r.mcc.predictedMcc,
        riskScore: r.scores.finalRiskScore,
        tier: r.scores.tier,
        primaryTypology: r.primaryTypology,
        mccDivergence: r.features.mccDivergence,
        txnCount: r.features.txnCount,
        totalVolume: r.features.totalVolume,
      })),
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Icon name="Search" size={14} className="text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ID, or descriptor…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="SlidersHorizontal" size={13} /> Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as RiskSortKey)}
            className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none"
          >
            <option value="risk">Risk score</option>
            <option value="volume">Total volume</option>
            <option value="divergence">MCC divergence</option>
            <option value="txns">Transaction count</option>
          </select>
        </div>
        <Button variant="ghost" onClick={doExport}>
          <Icon name="Download" size={15} /> Export CSV
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {RT_TYPOS.map((t) => (
          <Chip key={t} active={typo === t} onClick={() => setTypo(t)}>
            {t === "ALL" ? "All typologies" : TYPOLOGY_LABELS[t]}
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {RT_TIERS.map((t) => (
          <Chip key={t} active={tier === t} onClick={() => setTier(t)}>
            {t === "ALL" ? "All tiers" : t[0].toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between px-1">
        <SectionLabel>{fmtNumber(filtered.length)} matches</SectionLabel>
        {filtered.length > shown.length ? (
          <span className="text-[11px] text-ink-3">Showing top {shown.length}</span>
        ) : null}
      </div>

      <Card className="mt-1 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2.5 font-medium">Merchant</th>
                <th className="px-3 py-2.5 font-medium">Declared → Predicted MCC</th>
                <th className="px-3 py-2.5 font-medium">Typology</th>
                <th className="px-3 py-2.5 text-right font-medium">Divergence</th>
                <th className="px-3 py-2.5 text-right font-medium">Txns</th>
                <th className="px-3 py-2.5 text-right font-medium">Volume</th>
                <th className="px-3 py-2.5 text-right font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.merchant.merchantId}
                  onClick={() => {
                    selectMerchant(r.merchant.merchantId);
                    navigate(`/investigate/${r.merchant.merchantId}`);
                  }}
                  className="cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-2/60"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.merchant.tradeName}</div>
                    <div className="text-[11px] text-ink-3">{r.merchant.merchantId} · {r.merchant.city}, {r.merchant.state}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-ink-2">{r.merchant.declaredMcc}</span>
                      <Icon name="ArrowRight" size={12} className={r.mcc.hierarchyMatch ? "text-ink-3" : "text-critical"} />
                      <span className={r.mcc.hierarchyMatch ? "text-ink-2" : "text-critical"}>{r.mcc.predictedMcc}</span>
                    </div>
                    <div className="truncate text-[11px] text-ink-3">{mccLabel(r.mcc.predictedMcc)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-2">{TYPOLOGY_LABELS[r.primaryTypology]}</td>
                  <td className="px-3 py-2.5 text-right text-xs tnum">{r.features.mccDivergence.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tnum text-ink-2">{fmtNumber(r.features.txnCount)}</td>
                  <td className="px-3 py-2.5 text-right text-xs tnum text-ink-2">{fmtCurrency(r.features.totalVolume, true)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`text-base font-bold tnum ${TIER_COLOR[r.scores.tier]}`}>{Math.round(r.scores.finalRiskScore)}</span>
                      <TierBadge tier={r.scores.tier} small />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 px-1 text-[11px] text-ink-3">
        Divergence is the peer-adjusted distance between declared-MCC expectations and observed behavior ({fmtPct(1)} = complete mismatch).
        Click any row to open the investigation workspace.
      </p>
    </div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */

type ExplorerMode = "preview" | "risk" | "browse" | "sql";

export default function DataExplorer() {
  const [params] = useSearchParams();
  // Deep-link: /explorer?view=risk lands directly on a mode (used by the Command Center + tour).
  const initMode = params.get("view");
  const [mode, setMode] = useState<ExplorerMode>(
    initMode === "risk" || initMode === "browse" || initMode === "sql" ? initMode : "preview",
  );
  const svcRef = useRef<Svc | null>(null);
  const [sql, setSql] = useState<string>(SAMPLE_QUERIES[0].sql);
  const [autoRunToken, setAutoRunToken] = useState(0);

  function runInSql(query: string) {
    setSql(query);
    setMode("sql");
    setAutoRunToken((t) => t + 1);
  }

  function exploreTxns(m: ExplorerMerchant) {
    runInSql(
      `SELECT transaction_date, mcc, mcc_description, settlement_amount_usd,\n` +
      `       channel, recurring_flag, chargeback_flag, split_group_id\n` +
      `FROM transactions\n` +
      `WHERE merchant_id = '${m.merchant_id}'\n` +
      `ORDER BY transaction_datetime_utc;`,
    );
  }

  return (
    <div>
      <PageHeader
        icon="ScanSearch"
        title="Data Explorer"
        subtitle="Query the scored merchant book and its settlement transactions · synthetic, in-browser, no server"
        actions={
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setMode("preview")}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${mode === "preview" ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name="Table2" size={14} /> Preview
            </button>
            <button
              onClick={() => setMode("risk")}
              className={`inline-flex items-center gap-1.5 border-l border-border px-3 py-2 text-sm font-medium ${mode === "risk" ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name="Orbit" size={14} /> Risk table
            </button>
            <button
              onClick={() => setMode("browse")}
              className={`inline-flex items-center gap-1.5 border-l border-border px-3 py-2 text-sm font-medium ${mode === "browse" ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name="Filter" size={14} /> Browse
            </button>
            <button
              onClick={() => setMode("sql")}
              className={`inline-flex items-center gap-1.5 border-l border-border px-3 py-2 text-sm font-medium ${mode === "sql" ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name="Command" size={14} /> SQL console
            </button>
          </div>
        }
      />

      {mode === "risk" ? (
        <p className="mb-3 flex items-start gap-2 text-[11px] leading-snug text-ink-3">
          <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
          <span>
            Risk triage over every scored merchant — declared vs. predicted MCC divergence and typology, click a row to
            open the investigation workspace. <span className="text-ink-2">Browse</span> is the same book seen through
            model features with a drill into raw transactions.
          </span>
        </p>
      ) : null}

      {mode === "preview" ? (
        <PreviewMode onQuery={runInSql} />
      ) : mode === "risk" ? (
        <RiskTableMode />
      ) : mode === "browse" ? (
        <BrowseMode onExploreTxns={exploreTxns} />
      ) : (
        <SqlMode svcRef={svcRef} sql={sql} setSql={setSql} autoRunToken={autoRunToken} />
      )}

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-snug text-ink-3">
        <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
        <span>
          All entities are synthetic and PANs are masked. The transaction slice is a representative subset
          (every flagged merchant plus sampled clean merchants), not the full book. Scores and families are
          model outputs, not final compliance determinations.
        </span>
      </p>
    </div>
  );
}
