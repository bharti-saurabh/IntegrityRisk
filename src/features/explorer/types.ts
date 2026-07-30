// Per-feature attribution for a model-routed merchant's integrity score. The
// score is 100·P(abuse) from a logistic model over peer-relative feature
// z-scores (scripts/recompute_integrity_scores.py); each driver is one feature's
// log-odds contribution — the honest decomposition of WHY the model scored it.
// Present only on the model-routed universe (MCC-miscoding + the clean pool);
// rule-routed families carry an empty array.
export interface Driver {
  key: keyof ExplorerMerchant; // the feature column
  label: string;
  z: number; // oriented, peer-relative z (clipped) used by the model
  coef: number; // model log-odds weight for this feature
  contribution: number; // coef · z — this feature's push toward "abuse"
  share: number; // contribution as a fraction of the total upward push (0..1)
}

// Shape of a row in public/data/merchants.json (produced by build_explorer_data.py).
// Powers the dependency-free Browse table; the SQL console reads the parquet twins.
export interface ExplorerMerchant {
  merchant_id: string;
  merchant_name: string;
  corp_name: string;
  merchant_city: string;
  merchant_country: string;
  declared_mcc: number;
  mcc_group: string;
  txn_count: number;
  unique_cards: number;
  gross_sales_usd: number;
  avg_ticket_usd: number;
  pct_cnp: number;
  pct_recurring: number;
  pct_quasi_cash: number;
  pct_round_100: number;
  pct_cross_border: number;
  chargeback_rate_bps: number;
  refund_rate_amount: number;
  effective_interchange_bps: number;
  interchange_advantage_bps: number;
  n_distinct_descriptors: number;
  pct_txn_with_sub_merchant: number;
  surcharge_rate_bps: number;
  pct_txn_surcharged: number;
  integrity_risk_score: number;
  integrity_percentile: number;
  exposure_weighted_score: number;
  risk_tier: "Critical" | "High" | "Elevated" | "Monitor" | "Low";
  top_category: string;
  top_pattern: string;
  flag_for_investigation: number;
  rule_names: string;
  flag_reason: string;
  family: string;
  family_label: string;
  subtype: string;
  label: "interchange_abuse" | "integrity_violation" | "clean";
  drivers?: Driver[];
}

export async function loadMerchants(): Promise<ExplorerMerchant[]> {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}data/merchants.json`.replace(/\/{2,}/g, "/"));
  if (!res.ok) throw new Error(`Failed to load merchants.json (${res.status})`);
  return (await res.json()) as ExplorerMerchant[];
}

export const SAMPLE_QUERIES: { label: string; sql: string }[] = [
  {
    label: "Top flagged by exposure",
    sql: `SELECT merchant_name, family_label, risk_tier,
       round(integrity_risk_score, 1) AS risk, gross_sales_usd
FROM merchants
WHERE flag_for_investigation = 1
ORDER BY exposure_weighted_score DESC
LIMIT 15;`,
  },
  {
    label: "Interchange-abuse leaders",
    sql: `SELECT merchant_name, declared_mcc, mcc_group,
       round(effective_interchange_bps, 1) AS effective_bps,
       round(interchange_advantage_bps, 1) AS advantage_bps
FROM merchants
WHERE family = 'mcc_abuse'
ORDER BY interchange_advantage_bps DESC;`,
  },
  {
    label: "Split-ticket bursts",
    sql: `SELECT merchant_name, split_group_id,
       count(*) AS txns, round(sum(settlement_amount_usd), 2) AS amount
FROM transactions
WHERE split_group_id IS NOT NULL
GROUP BY merchant_name, split_group_id
ORDER BY txns DESC
LIMIT 20;`,
  },
  {
    label: "Miscoding by concealed category",
    sql: `SELECT subtype AS concealed_category,
       count(*) AS merchants,
       round(sum(gross_sales_usd) / 1e6, 2) AS sales_musd
FROM merchants
WHERE family = 'mcc_miscoding' AND subtype <> ''
GROUP BY subtype
ORDER BY merchants DESC;`,
  },
  {
    label: "Chargeback rate by family",
    sql: `SELECT family_label,
       count(*) AS merchants,
       round(avg(chargeback_rate_bps), 1) AS avg_cb_bps
FROM merchants
WHERE flag_for_investigation = 1
GROUP BY family_label
ORDER BY avg_cb_bps DESC;`,
  },
  {
    label: "Transactions of the riskiest merchant",
    sql: `SELECT t.transaction_date, t.mcc, t.mcc_description,
       t.settlement_amount_usd, t.channel, t.chargeback_flag
FROM transactions t
JOIN merchants m USING (merchant_id)
WHERE m.flag_for_investigation = 1
ORDER BY m.integrity_risk_score DESC, t.transaction_datetime_utc
LIMIT 50;`,
  },
];
