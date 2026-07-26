/// <reference lib="webworker" />
import { generateDataset, type GenConfig } from "@/data/generator";
import { runPipeline } from "@/analytics/pipeline";
import { computeAggregates } from "@/analytics/aggregates";
import { computeModelMetrics } from "@/analytics/modelMetrics";
import { seedCases } from "@/analytics/cases";
import { SCENARIO_MERCHANT_IDS } from "@/data/scenarios";
import { DEFAULT_RULES, type Rule } from "@/analytics/rules/rules";
import { Rng } from "@/utils/rng";
import type { EngineRequest, EngineResponse, EngineResult } from "@/workers/protocol";
import type { Transaction } from "@/types/domain";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: EngineResponse) {
  ctx.postMessage(msg);
}

function buildResult(config: GenConfig, rules: Rule[]): EngineResult {
  post({ type: "progress", phase: "Generating synthetic portfolio", pct: 10 });
  const dataset = generateDataset(config);

  post({ type: "progress", phase: "Engineering features & scoring", pct: 45 });
  const { records, txnByMerchant } = runPipeline(dataset, rules);

  post({ type: "progress", phase: "Aggregating portfolio", pct: 70 });
  const aggregates = computeAggregates(records, dataset.transactions, config.days);

  post({ type: "progress", phase: "Evaluating models", pct: 82 });
  const metrics = computeModelMetrics(records);
  const cases = seedCases(records);

  post({ type: "progress", phase: "Preparing evidence", pct: 92 });
  // Keep full transactions for showcase + top-risk merchants; sample the rest.
  const topRisk = new Set(records.slice(0, 60).map((r) => r.merchant.merchantId));
  const txnSamples: Record<string, Transaction[]> = {};
  for (const [merchantId, txns] of txnByMerchant) {
    const full = SCENARIO_MERCHANT_IDS.has(merchantId) || topRisk.has(merchantId);
    if (full) {
      txnSamples[merchantId] = txns.slice(0, 400);
    } else {
      const rng = new Rng(`sample-${merchantId}`);
      const sampled = txns.length <= 24 ? txns : rng.shuffle(txns).slice(0, 24);
      txnSamples[merchantId] = sampled.sort((a, b) => a.timestamp - b.timestamp);
    }
  }

  return {
    meta: {
      dataVersion: dataset.dataVersion,
      config,
      generatedAnchor: dataset.generatedAnchor,
      totalTransactions: dataset.transactions.length,
      knownBad: dataset.knownBad,
    },
    records,
    aggregates,
    metrics,
    cases,
    txnSamples,
  };
}

ctx.onmessage = (e: MessageEvent<EngineRequest>) => {
  try {
    const req = e.data;
    const rules = req.type === "reconfigure" ? req.rules : DEFAULT_RULES;
    const result = buildResult(req.config, rules);
    post({ type: "result", result });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
