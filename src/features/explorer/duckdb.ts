// Lazy DuckDB-WASM service for the Data Explorer SQL console.
//
// Loaded ONLY when the user opens the SQL tab (dynamic import in the page keeps
// the ~multi-MB WASM out of the main bundle). The engine + its worker come from
// jsDelivr; the two parquet slices are fetched from our own /data directory and
// registered as the `merchants` and `transactions` views. No keys, no backend —
// everything runs in the browser tab, so the public demo works unconfigured.
import * as duckdb from "@duckdb/duckdb-wasm";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface TableSchema {
  name: string;
  columns: { name: string; type: string }[];
}

const MAX_DISPLAY_ROWS = 2000;

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

function assetUrl(rel: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(`${base}${rel}`.replace(/\/{2,}/g, "/"), window.location.href).href;
}

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  await db.registerFileURL(
    "transactions.parquet",
    assetUrl("data/transactions.parquet"),
    duckdb.DuckDBDataProtocol.HTTP,
    false,
  );
  await db.registerFileURL(
    "merchants.parquet",
    assetUrl("data/merchants.parquet"),
    duckdb.DuckDBDataProtocol.HTTP,
    false,
  );

  const c = await db.connect();
  await c.query("CREATE OR REPLACE VIEW merchants AS SELECT * FROM read_parquet('merchants.parquet')");
  await c.query("CREATE OR REPLACE VIEW transactions AS SELECT * FROM read_parquet('transactions.parquet')");
  conn = c;
  return db;
}

/** Idempotent — the first caller triggers load; the rest await the same promise. */
export function ensureDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

function cell(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  return v;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  await ensureDb();
  if (!conn) throw new Error("Database connection not ready");
  const started = performance.now();
  const table = await conn.query(sql);
  const columns = table.schema.fields.map((f) => f.name);
  const all = table.toArray();
  const truncated = all.length > MAX_DISPLAY_ROWS;
  const shown = truncated ? all.slice(0, MAX_DISPLAY_ROWS) : all;
  const rows = shown.map((r) => {
    const obj = r as Record<string, unknown>;
    return columns.map((c) => cell(obj[c]));
  });
  return {
    columns,
    rows,
    rowCount: all.length,
    truncated,
    elapsedMs: performance.now() - started,
  };
}

export async function loadSchema(): Promise<TableSchema[]> {
  await ensureDb();
  if (!conn) throw new Error("Database connection not ready");
  const out: TableSchema[] = [];
  for (const name of ["merchants", "transactions"]) {
    const t = await conn.query(`DESCRIBE ${name}`);
    const cols = t.toArray().map((r) => {
      const o = r as Record<string, unknown>;
      return { name: String(o.column_name), type: String(o.column_type) };
    });
    out.push({ name, columns: cols });
  }
  return out;
}
