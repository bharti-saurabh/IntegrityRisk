import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, SectionLabel, Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { fmtCurrency, fmtNumber, fmtPct } from "@/utils/format";
import { FAMILY_META, TIER_HEX, type OverviewTier } from "@/data/overview";
import { loadMerchants, SAMPLE_QUERIES, type ExplorerMerchant } from "@/features/explorer/types";
import { loadTxnPreview, humanizeColumn, type TxnPreview, type PreviewValue } from "@/features/explorer/preview";
import type { QueryResult, TableSchema } from "@/features/explorer/duckdb";

type Svc = typeof import("@/features/explorer/duckdb");

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

  // Auto-run once the engine is ready when a hand-off from Preview bumps the token.
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
              request was blocked. The <span className="font-semibold">Preview</span> tab works fully offline;
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

/* ─────────────────────────── Page ─────────────────────────── */

type ExplorerMode = "preview" | "sql";

export default function DataExplorer() {
  const [params] = useSearchParams();
  // Deep-link: /explorer?view=sql lands directly on the SQL console (used by the tour).
  const initMode = params.get("view");
  const [mode, setMode] = useState<ExplorerMode>(initMode === "sql" ? "sql" : "preview");
  const svcRef = useRef<Svc | null>(null);
  const [sql, setSql] = useState<string>(SAMPLE_QUERIES[0].sql);
  const [autoRunToken, setAutoRunToken] = useState(0);

  function runInSql(query: string) {
    setSql(query);
    setMode("sql");
    setAutoRunToken((t) => t + 1);
  }

  return (
    <div>
      <PageHeader
        icon="ScanSearch"
        title="Data Explorer"
        subtitle="Preview the merchant book and its settlement transactions, then query them live · synthetic, in-browser, no server"
        actions={
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setMode("preview")}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${mode === "preview" ? "bg-cyan text-white" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
            >
              <Icon name="Table2" size={14} /> Preview
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

      {mode === "preview" ? <PreviewMode onQuery={runInSql} /> : <SqlMode svcRef={svcRef} sql={sql} setSql={setSql} autoRunToken={autoRunToken} />}

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
