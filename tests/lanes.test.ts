import { describe, it, expect } from "vitest";
import { generateDataset, DEFAULT_GEN_CONFIG } from "@/data/generator";
import { runPipeline } from "@/analytics/pipeline";
import { computeAggregates } from "@/analytics/aggregates";
import { activeTypologies } from "@/data/responseLanes";

describe("response lanes", () => {
  const dataset = generateDataset(DEFAULT_GEN_CONFIG);
  const { records } = runPipeline(dataset);
  const agg = computeAggregates(records, dataset.transactions, DEFAULT_GEN_CONFIG.days);
  const flagged = records.filter((r) => r.scores.tier === "high" || r.scores.tier === "critical");

  it("coverage is non-degenerate", () => {
    console.log("coverage:", agg.coverage);
    console.log("thresholds:", agg.typologyActiveThresholds);
    expect(agg.coverage.governedPct).toBeGreaterThan(0);
    expect(agg.coverage.governedPct).toBeLessThan(1);
  });

  it("routes every flagged merchant into exactly one lane", () => {
    const laneTotal = agg.laneSummaries.reduce((a, l) => a + l.merchants, 0);
    console.log("lanes:", agg.laneSummaries.map((l) => `${l.lane}: ${l.merchants}m ${l.critical}c $${l.exposure} ${l.trendPct}%`));
    expect(laneTotal).toBe(flagged.length);
  });

  it("tags are selective, not universal", () => {
    const counts = flagged.map((r) => activeTypologies(r, agg.typologyActiveThresholds).length);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const multi = counts.filter((c) => c > 1).length;
    console.log(`avg tags/merchant = ${avg.toFixed(2)}; multi-typology = ${multi}/${flagged.length}`);
    console.log("top queue rows:", [...flagged]
      .sort((a,b)=>b.scores.finalRiskScore-a.scores.finalRiskScore).slice(0,8)
      .map((r)=>`${Math.round(r.scores.finalRiskScore)} ${r.merchant.tradeName} [${activeTypologies(r, agg.typologyActiveThresholds).join(", ")}]`));
    // Every flagged merchant must keep at least its primary tag...
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    // ...but tagging must not collapse to "everything on everyone".
    expect(avg).toBeLessThan(2.5);
    expect(multi / flagged.length).toBeLessThan(0.9);
  });
});
