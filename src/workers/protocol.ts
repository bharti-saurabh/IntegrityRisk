import type {
  MerchantRiskRecord,
  InvestigationCase,
  Transaction,
} from "@/types/domain";
import type { GenConfig, KnownBadEntity } from "@/data/generator";
import type { PortfolioAggregates } from "@/analytics/aggregates";
import type { ModelMetrics } from "@/analytics/modelMetrics";
import type { Rule } from "@/analytics/rules/rules";

export interface EngineMeta {
  dataVersion: string;
  config: GenConfig;
  generatedAnchor: number;
  totalTransactions: number;
  knownBad: KnownBadEntity[];
}

export interface EngineResult {
  meta: EngineMeta;
  records: MerchantRiskRecord[];
  aggregates: PortfolioAggregates;
  metrics: ModelMetrics;
  cases: InvestigationCase[];
  /** Full transactions for showcase/top-risk merchants, sampled for the rest. */
  txnSamples: Record<string, Transaction[]>;
}

export type EngineRequest =
  | { type: "init"; config: GenConfig }
  | { type: "reconfigure"; config: GenConfig; rules: Rule[] };

export type EngineResponse =
  | { type: "progress"; phase: string; pct: number }
  | { type: "result"; result: EngineResult }
  | { type: "error"; message: string };
