// Offline-safe transaction-level preview (public/data/transactions-preview.json).
// A curated cross-typology sample of the shipped transaction slice so the Data
// Explorer "Preview" tab can show raw transactions WITHOUT booting DuckDB / a CDN —
// consistent with the dependency-free Browse table. All entities synthetic; PANs masked.

export type PreviewValue = string | number | boolean | null;

export interface TxnPreviewMeta {
  source: string;
  note: string;
  totalRowsInSlice: number;
  totalColumnsInSlice: number;
  previewRows: number;
  previewColumns: string[];
  merchants: { merchant_id: string; family: string }[];
}

export interface TxnPreview {
  meta: TxnPreviewMeta;
  rows: Record<string, PreviewValue>[];
}

export async function loadTxnPreview(): Promise<TxnPreview> {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}data/transactions-preview.json`.replace(/\/{2,}/g, "/"));
  if (!res.ok) throw new Error(`Failed to load transactions-preview.json (${res.status})`);
  return (await res.json()) as TxnPreview;
}

// snake_case → Title Case for column headers, with a few domain-specific overrides.
const LABEL_OVERRIDES: Record<string, string> = {
  pan_masked: "PAN (masked)",
  mcc: "MCC",
  mcc_description: "MCC description",
  cnp: "CNP",
  settlement_amount_usd: "Settlement (USD)",
  transaction_currency_code: "Currency",
  card_present_flag: "Card present",
  issuer_country: "Issuer",
  merchant_country: "Country",
  split_group_id: "Split group",
  local_hour: "Hour",
  approved_flag: "Approved",
  chargeback_flag: "Chargeback",
  recurring_flag: "Recurring",
};

export function humanizeColumn(key: string): string {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return key
    .replace(/_/g, " ")
    .replace(/\busd\b/gi, "USD")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bbps\b/gi, "bps")
    .replace(/\bmcc\b/gi, "MCC")
    .replace(/\bpct\b/gi, "%")
    .replace(/^\w/, (c) => c.toUpperCase());
}
