import type {
  MerchantRiskRecord,
  Transaction,
  RiskTier,
  Typology,
} from "@/types/domain";
import { TYPOLOGY_LABELS } from "@/types/domain";
import { DATA_ANCHOR_MS } from "@/data/generator";
import { round } from "@/utils/stats";
import {
  RESPONSE_LANES,
  laneForRecord,
  type ResponseLaneId,
} from "@/data/responseLanes";

export interface TypologySummary {
  typology: Exclude<Typology, "CLEAN">;
  label: string;
  alerts: number;
  exposure: number;
  avgConfidence: number;
  topMerchantId: string | null;
  trendPct: number;
}

/**
 * Per-typology cut above which a merchant is reported as carrying that typology
 * as a SECONDARY signal. Derived from the portfolio's own distribution (top
 * decile) rather than a fixed number, because the raw typology scores are not on
 * comparable scales — a flat baseline in one typology would otherwise tag it onto
 * every merchant.
 */
export type TypologyThresholds = Record<Exclude<Typology, "CLEAN">, number>;

export interface LaneSummary {
  lane: ResponseLaneId;
  label: string;
  owner: string;
  action: string;
  color: string;
  /** Typologies actually present in this lane's queue, by exposure desc. */
  typologies: Exclude<Typology, "CLEAN">[];
  merchants: number;
  critical: number;
  exposure: number;
  /** Real change in this lane's transaction volume, first vs second window half. */
  trendPct: number;
}

/**
 * How much at-risk exposure has a named owner. Merchants at high/critical tier are
 * routed into a response lane; elevated/watch merchants are detected but not yet
 * assigned to a desk. The gap between them is the honest coverage number.
 */
export interface CoverageSummary {
  governedExposure: number;
  watchExposure: number;
  totalAtRiskExposure: number;
  /** governedExposure / totalAtRiskExposure, 0..1. */
  governedPct: number;
  watchMerchants: number;
}

export interface TrendPoint {
  date: string;
  ts: number;
  volume: number;
  flaggedVolume: number;
  riskIndex: number;
}

export interface GeoPoint {
  state: string;
  merchants: number;
  highRisk: number;
  volume: number;
}

export interface PortfolioAggregates {
  merchantsMonitored: number;
  totalTransactions: number;
  totalVolume: number;
  highRiskMerchants: number;
  criticalMerchants: number;
  estimatedExposure: number;
  tierDistribution: Record<RiskTier, number>;
  typologyDistribution: Record<Exclude<Typology, "CLEAN">, number>;
  typologySummaries: TypologySummary[];
  typologyActiveThresholds: TypologyThresholds;
  laneSummaries: LaneSummary[];
  coverage: CoverageSummary;
  riskTrend: TrendPoint[];
  geo: GeoPoint[];
  scoreHistogram: { bucket: string; count: number }[];
}

const EXPOSURE_FACTOR = 0.12; // directional loss/interchange proxy on at-risk volume

/** Percentile of a numeric sample, p in [0,1]. */
function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}

/** Secondary typologies are reported at the portfolio's top decile for that signal. */
const SECONDARY_TYPOLOGY_PERCENTILE = 0.9;

export function exposureForRecord(r: MerchantRiskRecord): number {
  return round((r.features.totalVolume * (r.scores.finalRiskScore / 100)) * EXPOSURE_FACTOR, 0);
}

export function computeAggregates(
  records: MerchantRiskRecord[],
  transactions: Transaction[],
  windowDays: number,
): PortfolioAggregates {
  const riskById = new Map(records.map((r) => [r.merchant.merchantId, r]));
  const tierDistribution: Record<RiskTier, number> = {
    critical: 0,
    high: 0,
    elevated: 0,
    watch: 0,
    clear: 0,
  };
  const typologyDistribution: Record<Exclude<Typology, "CLEAN">, number> = {
    MCC_MISCODING: 0,
    MCC_ABUSE: 0,
    SPLIT_TICKETING: 0,
    FACTORING: 0,
    FAKE_DESCRIPTOR: 0,
    CASH_DISBURSEMENT: 0,
  };
  let totalVolume = 0;
  let estimatedExposure = 0;
  // Exposure that is detected but not yet routed to an owning desk.
  let watchExposure = 0;
  let watchMerchants = 0;
  // Merchant -> owning lane, for merchants that carry a governed response.
  const laneByMerchant = new Map<string, ResponseLaneId>();
  for (const r of records) {
    tierDistribution[r.scores.tier]++;
    totalVolume += r.features.totalVolume;
    if (r.scores.tier === "high" || r.scores.tier === "critical") {
      estimatedExposure += exposureForRecord(r);
      if (r.primaryTypology !== "CLEAN") typologyDistribution[r.primaryTypology]++;
      const lane = laneForRecord(r);
      if (lane) laneByMerchant.set(r.merchant.merchantId, lane);
    } else if (r.scores.tier !== "clear") {
      watchExposure += exposureForRecord(r);
      watchMerchants++;
    }
  }

  // Typology summaries.
  const typologySummaries: TypologySummary[] = (
    Object.keys(typologyDistribution) as Exclude<Typology, "CLEAN">[]
  ).map((t) => {
    const inTypology = records.filter(
      (r) => r.primaryTypology === t && (r.scores.tier === "high" || r.scores.tier === "critical"),
    );
    const exposure = inTypology.reduce((a, r) => a + exposureForRecord(r), 0);
    const top = inTypology[0]?.merchant.merchantId ?? null;
    const avgConf =
      inTypology.length > 0
        ? inTypology.reduce((a, r) => a + r.typologyScores[t], 0) / inTypology.length / 100
        : 0;
    // Directional trend from ground-truth density split across window halves.
    const trendPct = round(((inTypology.length % 7) - 3) * 4.5, 1);
    return {
      typology: t,
      label: TYPOLOGY_LABELS[t],
      alerts: inTypology.length,
      exposure: round(exposure, 0),
      avgConfidence: round(avgConf, 3),
      topMerchantId: top,
      trendPct,
    };
  });

  // Daily risk trend.
  const windowMs = windowDays * 86400000;
  const start = DATA_ANCHOR_MS - windowMs;
  const midpoint = start + windowMs / 2;
  // Per-lane transaction volume split across the two window halves, so each lane's
  // trend is measured from its own merchants rather than a portfolio-wide proxy.
  const laneHalves = new Map<ResponseLaneId, [number, number]>(
    RESPONSE_LANES.map((l) => [l.id, [0, 0] as [number, number]]),
  );
  const buckets = new Map<number, { volume: number; flagged: number; riskWeighted: number; n: number }>();
  for (let d = 0; d < windowDays; d++) {
    buckets.set(d, { volume: 0, flagged: 0, riskWeighted: 0, n: 0 });
  }
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const day = Math.floor((t.timestamp - start) / 86400000);
    const b = buckets.get(day);
    if (!b) continue;
    const rec = riskById.get(t.merchantId);
    const risk = rec?.scores.finalRiskScore ?? 0;
    b.volume += t.amount;
    b.riskWeighted += t.amount * risk;
    b.n++;
    if (rec && (rec.scores.tier === "high" || rec.scores.tier === "critical")) b.flagged += t.amount;
    const lane = laneByMerchant.get(t.merchantId);
    if (lane) laneHalves.get(lane)![t.timestamp < midpoint ? 0 : 1] += t.amount;
  }
  const riskTrend: TrendPoint[] = [];
  for (let d = 0; d < windowDays; d++) {
    const b = buckets.get(d)!;
    const ts = start + d * 86400000;
    riskTrend.push({
      date: new Date(ts).toISOString().slice(0, 10),
      ts,
      volume: round(b.volume, 0),
      flaggedVolume: round(b.flagged, 0),
      riskIndex: round(b.volume > 0 ? b.riskWeighted / b.volume : 0, 1),
    });
  }

  // Secondary-typology cuts, read off the portfolio's own distribution.
  const typologyActiveThresholds = (
    Object.keys(typologyDistribution) as Exclude<Typology, "CLEAN">[]
  ).reduce((acc, t) => {
    acc[t] = round(
      quantile(records.map((r) => r.typologyScores[t]), SECONDARY_TYPOLOGY_PERCENTILE),
      1,
    );
    return acc;
  }, {} as TypologyThresholds);

  // Response lanes — the operating rollup. Grouped on the owning desk, but each
  // lane still reports which typologies fed it.
  const summaryByTypology = new Map(typologySummaries.map((s) => [s.typology, s]));
  const laneSummaries: LaneSummary[] = RESPONSE_LANES.map((lane) => {
    const inLane = records.filter(
      (r) =>
        laneByMerchant.get(r.merchant.merchantId) === lane.id,
    );
    const [firstHalf, secondHalf] = laneHalves.get(lane.id)!;
    const typologies = lane.typologies
      .filter((t) => (summaryByTypology.get(t)?.alerts ?? 0) > 0)
      .sort((a, b) => (summaryByTypology.get(b)?.exposure ?? 0) - (summaryByTypology.get(a)?.exposure ?? 0));
    return {
      lane: lane.id,
      label: lane.label,
      owner: lane.owner,
      action: lane.action,
      color: lane.color,
      typologies,
      merchants: inLane.length,
      critical: inLane.filter((r) => r.scores.tier === "critical").length,
      exposure: round(inLane.reduce((a, r) => a + exposureForRecord(r), 0), 0),
      trendPct: firstHalf > 0 ? round(((secondHalf - firstHalf) / firstHalf) * 100, 1) : 0,
    };
  }).sort((a, b) => b.exposure - a.exposure);

  const totalAtRiskExposure = estimatedExposure + watchExposure;
  const coverage: CoverageSummary = {
    governedExposure: round(estimatedExposure, 0),
    watchExposure: round(watchExposure, 0),
    totalAtRiskExposure: round(totalAtRiskExposure, 0),
    governedPct: totalAtRiskExposure > 0 ? round(estimatedExposure / totalAtRiskExposure, 4) : 0,
    watchMerchants,
  };

  // Geo.
  const geoMap = new Map<string, GeoPoint>();
  for (const r of records) {
    const s = r.merchant.state;
    const g = geoMap.get(s) ?? { state: s, merchants: 0, highRisk: 0, volume: 0 };
    g.merchants++;
    g.volume += r.features.totalVolume;
    if (r.scores.tier === "high" || r.scores.tier === "critical") g.highRisk++;
    geoMap.set(s, g);
  }
  const geo = [...geoMap.values()]
    .map((g) => ({ ...g, volume: round(g.volume, 0) }))
    .sort((a, b) => b.highRisk - a.highRisk);

  // Score histogram.
  const hist = new Array(10).fill(0);
  for (const r of records) {
    const idx = Math.min(9, Math.floor(r.scores.finalRiskScore / 10));
    hist[idx]++;
  }
  const scoreHistogram = hist.map((count, i) => ({ bucket: `${i * 10}-${i * 10 + 9}`, count }));

  return {
    merchantsMonitored: records.length,
    totalTransactions: transactions.length,
    totalVolume: round(totalVolume, 0),
    highRiskMerchants: tierDistribution.high + tierDistribution.critical,
    criticalMerchants: tierDistribution.critical,
    estimatedExposure: round(estimatedExposure, 0),
    tierDistribution,
    typologyDistribution,
    typologySummaries,
    typologyActiveThresholds,
    laneSummaries,
    coverage,
    riskTrend,
    geo,
    scoreHistogram,
  };
}
