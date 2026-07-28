import { MCC_BY_CODE } from "@/data/mccTaxonomy";
import type { Typology } from "@/types/domain";

// A behavior profile is the parameter set the generator samples transactions
// from. It is derived from the merchant's ACTUAL business (actualMcc) plus any
// scenario overrides — that is what creates the gap between declared MCC and
// observed behavior that the detection layer later recovers.
export interface BehaviorProfile {
  cnpRatio: number;
  nightRatio: number;
  weekendBoost: number;
  ticketMu: number; // lognormal location
  ticketSigma: number; // lognormal scale
  roundDollarProb: number;
  refundRate: number;
  disputeRate: number;
  notRecognizedShare: number; // share of disputes that are "not recognized"
  crossBorderRatio: number;
  cashEquivRatio: number;
  walletLoadRatio: number;
  refundAfterProb: number;
  dailyTxns: number;
  uniqueCardShare: number;
  descriptorPoolSize: number;
  highRiskCustomerAffinity: number; // 0..1 preference for high-risk card pool
  /** 0..1 share of card-present volume forced into keyed/fallback entry
   * (interchange-downgrade signature). 0 for normal merchants. */
  manualEntryBoost: number;
  productKeywords: string[];
}

function muSigmaFromRange([lo, hi]: [number, number]): [number, number] {
  // Treat the range as roughly the central 80% (p10..p90) of a lognormal.
  const median = Math.sqrt(Math.max(lo, 1) * Math.max(hi, lo + 1));
  const mu = Math.log(median);
  const sigma = Math.max(0.2, (Math.log(hi) - Math.log(Math.max(lo, 1))) / 2.56);
  return [mu, sigma];
}

export function baseProfile(mcc: string): BehaviorProfile {
  const def = MCC_BY_CODE[mcc] ?? MCC_BY_CODE["5999"];
  const [mu, sigma] = muSigmaFromRange(def.typicalTicketRange);
  const highRisk = def.riskTier === "prohibited-adjacent" || def.riskTier === "high";
  return {
    cnpRatio: 1 - def.typicalCardPresentRatio,
    nightRatio: def.typicalNightRatio,
    weekendBoost: def.category.includes("Bar") ? 1.8 : 1.05,
    ticketMu: mu,
    ticketSigma: sigma,
    roundDollarProb: highRisk ? 0.28 : 0.08,
    refundRate: def.typicalRefundRate,
    disputeRate: def.typicalDisputeRate,
    notRecognizedShare: highRisk ? 0.4 : 0.12,
    crossBorderRatio: def.parentCategory.includes("Digital") ? 0.28 : 0.04,
    cashEquivRatio: mcc === "6051" ? 0.75 : mcc === "7995" ? 0.35 : 0.02,
    walletLoadRatio: mcc === "6051" ? 0.5 : 0.01,
    refundAfterProb: 0.05,
    dailyTxns: 3.2,
    uniqueCardShare: def.parentCategory.includes("Digital") ? 0.82 : 0.55,
    descriptorPoolSize: 1,
    highRiskCustomerAffinity: highRisk ? 0.55 : 0.12,
    manualEntryBoost: 0,
    productKeywords: def.expectedKeywords,
  };
}

// Overrides applied when the declared MCC differs from actual, or when a
// scenario spec asks for a stronger signal.
export function applyTypologyShaping(
  p: BehaviorProfile,
  typology: Typology,
  overrides?: Record<string, unknown>,
): BehaviorProfile {
  const o = overrides ?? {};
  const out = { ...p };
  switch (typology) {
    case "CASH_DISBURSEMENT":
      out.roundDollarProb = Math.max(out.roundDollarProb, 0.6);
      out.refundAfterProb = 0.35;
      out.cashEquivRatio = Math.max(out.cashEquivRatio, 0.4);
      out.uniqueCardShare = 0.35;
      break;
    case "MCC_ABUSE":
      // Honest line of business (keep CNP/night/ticket near the declared retail
      // norm so content-divergence stays low), but settle via keyed/fallback,
      // cross-border entry that doesn't qualify for the claimed interchange band.
      out.manualEntryBoost = 0.55;
      out.crossBorderRatio = Math.max(out.crossBorderRatio, 0.28);
      out.disputeRate = Math.min(out.disputeRate, 0.012);
      out.roundDollarProb = Math.min(out.roundDollarProb, 0.06);
      break;
    case "SPLIT_TICKETING":
      out.dailyTxns = 5.5;
      break;
    case "FACTORING":
      out.descriptorPoolSize = 6;
      out.uniqueCardShare = 0.9;
      out.crossBorderRatio = Math.max(out.crossBorderRatio, 0.25);
      break;
    case "CARD_SURCHARGE":
      // A card surcharge added over the cap / on prohibited debit / undisclosed
      // surfaces as an unexpected fee → "not recognized" disputes, chargebacks and
      // fee reversals, plus a modest lift in effective ticket from the added fee.
      out.notRecognizedShare = 0.62;
      out.disputeRate = Math.max(out.disputeRate, 0.05);
      out.refundRate = Math.max(out.refundRate, 0.09);
      out.ticketMu = out.ticketMu + 0.03;
      break;
    default:
      break;
  }
  if (typeof o.roundDollar === "number") out.roundDollarProb = o.roundDollar as number;
  if (typeof o.refundAfter === "number") out.refundAfterProb = o.refundAfter as number;
  if (typeof o.walletLoad === "number") out.walletLoadRatio = o.walletLoad as number;
  if (typeof o.descriptorCount === "number") out.descriptorPoolSize = o.descriptorCount as number;
  return out;
}
