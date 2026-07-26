import { describe, it, expect } from "vitest";
import { generateDataset, DEFAULT_GEN_CONFIG } from "@/data/generator";
import { runPipeline } from "@/analytics/pipeline";
import { computeAggregates } from "@/analytics/aggregates";
import { computeModelMetrics } from "@/analytics/modelMetrics";
import { seedCases } from "@/analytics/cases";
import { SCENARIO_SPECS } from "@/data/scenarios";

// Generate once and reuse across assertions (the acceptance dataset is large).
const dataset = generateDataset(DEFAULT_GEN_CONFIG);
const pipeline = runPipeline(dataset);

describe("synthetic data engine", () => {
  it("generates the acceptance-criterion transaction volume (>= 100k)", () => {
    expect(dataset.transactions.length).toBeGreaterThanOrEqual(100_000);
  });

  it("generates 1,000-5,000 merchants", () => {
    expect(dataset.merchants.length).toBeGreaterThanOrEqual(1_000);
    expect(dataset.merchants.length).toBeLessThanOrEqual(5_000);
  });

  it("includes every showcase scenario merchant", () => {
    const ids = new Set(dataset.merchants.map((m) => m.merchantId));
    for (const spec of SCENARIO_SPECS) {
      expect(ids.has(spec.merchantId)).toBe(true);
    }
  });

  it("uses synthetic card tokens — never a real 13-19 digit PAN", () => {
    const sample = dataset.transactions.slice(0, 500);
    expect(sample.every((t) => /^C-\d{6}$/.test(t.cardId))).toBe(true);
    expect(sample.some((t) => /\d{13,19}/.test(t.cardId))).toBe(false);
  });
});

describe("scoring pipeline", () => {
  it("produces one record per merchant with scores in [0,100]", () => {
    expect(pipeline.records.length).toBe(dataset.merchants.length);
    for (const r of pipeline.records) {
      expect(r.scores.finalRiskScore).toBeGreaterThanOrEqual(0);
      expect(r.scores.finalRiskScore).toBeLessThanOrEqual(100);
    }
  });

  it("flags injected abuse merchants above clean merchants on average", () => {
    const bad = pipeline.records.filter((r) => r.merchant.groundTruthAbuseFlag);
    const clean = pipeline.records.filter((r) => !r.merchant.groundTruthAbuseFlag);
    const avg = (xs: typeof bad) => xs.reduce((a, r) => a + r.scores.finalRiskScore, 0) / xs.length;
    expect(avg(bad)).toBeGreaterThan(avg(clean) + 15);
  });

  it("recovers MCC miscoding — declared != predicted for flagship scenario", () => {
    const flagship = SCENARIO_SPECS.find((s) => s.primaryTypology === "MCC_MISCODING")!;
    const rec = pipeline.records.find((r) => r.merchant.merchantId === flagship.merchantId)!;
    expect(rec.mcc.declaredMcc).not.toBe(rec.mcc.predictedMcc);
    expect(rec.features.mccDivergence).toBeGreaterThan(0.2);
  });
});

describe("model metrics", () => {
  const metrics = computeModelMetrics(pipeline.records, 62);
  it("achieves usable precision and separates classes (ROC-AUC) against ground truth", () => {
    // At the default operating threshold precision is deliberately high (analyst
    // workload is precious); recall climbs as the impact simulator lowers the bar.
    expect(metrics.precision).toBeGreaterThan(0.5);
    expect(metrics.recall).toBeGreaterThan(0.3);
    expect(metrics.rocAuc).toBeGreaterThan(0.75);
  });
});

describe("determinism", () => {
  it("re-generates byte-identical scores from the same seed", () => {
    const ds2 = generateDataset(DEFAULT_GEN_CONFIG);
    const p2 = runPipeline(ds2);
    expect(ds2.transactions.length).toBe(dataset.transactions.length);
    const a = pipeline.records.map((r) => r.scores.finalRiskScore).slice(0, 200);
    const b = p2.records.map((r) => r.scores.finalRiskScore).slice(0, 200);
    expect(b).toEqual(a);
  });
});

describe("case seeding", () => {
  it("creates cases from the highest-risk records", () => {
    const cases = seedCases(pipeline.records);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.caseId && c.merchantId && c.slaDueAt)).toBe(true);
  });
});

describe("aggregates", () => {
  it("computes a portfolio summary consistent with the records", () => {
    const agg = computeAggregates(pipeline.records, dataset.transactions, DEFAULT_GEN_CONFIG.days);
    expect(agg.merchantsMonitored).toBe(pipeline.records.length);
    expect(agg.totalTransactions).toBe(dataset.transactions.length);
    expect(agg.highRiskMerchants).toBeGreaterThan(0);
  });
});
