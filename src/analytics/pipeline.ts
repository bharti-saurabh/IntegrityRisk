import type {
  MerchantRiskRecord,
  Transaction,
  MerchantProfile,
} from "@/types/domain";
import type { GeneratedDataset } from "@/data/generator";
import { computeMerchantFeatures } from "@/analytics/features/merchantFeatures";
import { predictMcc } from "@/analytics/models/mccModel";
import { scoreArchetypes } from "@/analytics/models/archetypes";
import { evaluateRules, type Rule, DEFAULT_RULES } from "@/analytics/rules/rules";
import {
  computeScores,
  computeFeatureContributions,
  computeTypologyScores,
  primaryTypologyFrom,
} from "@/analytics/scoring/ensemble";
import { buildInfraIndex, computeGraphMetrics } from "@/analytics/graph/graph";
import { mean, stdev, zScore } from "@/utils/stats";

export interface PipelineResult {
  records: MerchantRiskRecord[];
  txnByMerchant: Map<string, Transaction[]>;
}

export function groupTransactions(txns: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const t of txns) {
    const arr = map.get(t.merchantId);
    if (arr) arr.push(t);
    else map.set(t.merchantId, [t]);
  }
  return map;
}

function keywordTextFor(m: MerchantProfile, txns: Transaction[]): string[] {
  const set = new Set<string>();
  for (const t of txns) {
    set.add(t.productSignal);
    if (set.size > 40) break;
  }
  for (const tok of m.descriptor.toLowerCase().split(/\s+/)) set.add(tok);
  for (const d of m.alternateDescriptors) for (const tok of d.toLowerCase().split(/\s+/)) set.add(tok);
  return [...set];
}

export function runPipeline(
  dataset: GeneratedDataset,
  rules: Rule[] = DEFAULT_RULES,
): PipelineResult {
  const txnByMerchant = groupTransactions(dataset.transactions);
  const infra = buildInfraIndex(dataset.merchants);

  // Pass 1: base features.
  const featuresByMerchant = new Map<string, ReturnType<typeof computeMerchantFeatures>>();
  for (const m of dataset.merchants) {
    const txns = txnByMerchant.get(m.merchantId) ?? [];
    const f = computeMerchantFeatures(m, txns);
    const g = computeGraphMetrics(m, infra, dataset.knownBad);
    f.sharedBankAccountCount = g.sharedBankAccountCount;
    f.sharedIpCount = g.sharedIpCount;
    f.sharedDeviceCount = g.sharedDeviceCount;
    f.submerchantCount = g.submerchantCount;
    featuresByMerchant.set(m.merchantId, f);
  }

  // Pass 2: peer group statistics (by declared MCC) → z-scores.
  const groups = new Map<string, MerchantProfile[]>();
  for (const m of dataset.merchants) {
    const arr = groups.get(m.declaredMcc) ?? [];
    arr.push(m);
    groups.set(m.declaredMcc, arr);
  }
  const peerStats = new Map<string, { night: [number, number]; cnp: [number, number]; ticket: [number, number] }>();
  for (const [mcc, ms] of groups) {
    const nights = ms.map((m) => featuresByMerchant.get(m.merchantId)!.nightRatio);
    const cnps = ms.map((m) => featuresByMerchant.get(m.merchantId)!.cardNotPresentRatio);
    const tickets = ms.map((m) => featuresByMerchant.get(m.merchantId)!.avgTicket);
    peerStats.set(mcc, {
      night: [mean(nights), stdev(nights)],
      cnp: [mean(cnps), stdev(cnps)],
      ticket: [mean(tickets), stdev(tickets)],
    });
  }

  // Pass 3: scoring.
  const records: MerchantRiskRecord[] = [];
  for (const m of dataset.merchants) {
    const f = featuresByMerchant.get(m.merchantId)!;
    const ps = peerStats.get(m.declaredMcc)!;
    f.peerNightZ = Number(zScore(f.nightRatio, ps.night[0], ps.night[1]).toFixed(3));
    f.peerCnpZ = Number(zScore(f.cardNotPresentRatio, ps.cnp[0], ps.cnp[1]).toFixed(3));
    f.peerTicketZ = Number(zScore(f.avgTicket, ps.ticket[0], ps.ticket[1]).toFixed(3));

    const txns = txnByMerchant.get(m.merchantId) ?? [];
    const keywordText = keywordTextFor(m, txns);
    const mcc = predictMcc({
      features: f,
      declaredMcc: m.declaredMcc,
      keywordText,
    });
    const archetypeMatches = scoreArchetypes(f, keywordText);
    const g = computeGraphMetrics(m, infra, dataset.knownBad);
    const ruleHits = evaluateRules(m, f, rules);
    const scores = computeScores(f, mcc, ruleHits, g.graphScore);
    const topFeatures = computeFeatureContributions(f).slice(0, 8);
    const typologyScores = computeTypologyScores(f, mcc, ruleHits, g.graphScore);
    const primaryTypology = primaryTypologyFrom(typologyScores, scores.finalRiskScore);

    // Backfill merchant summary fields from computed data (no hardcoded values).
    m.averageTicket = f.avgTicket;
    m.annualVolume = Math.round((f.totalVolume / dataset.config.days) * 365);

    records.push({
      merchant: m,
      features: f,
      scores,
      mcc,
      ruleHits,
      topFeatures,
      primaryTypology,
      typologyScores,
      archetypeMatches,
    });
  }

  records.sort((a, b) => b.scores.finalRiskScore - a.scores.finalRiskScore);
  return { records, txnByMerchant };
}
