import type { MerchantProfile, Transaction, MerchantFeatures } from "@/types/domain";
import { MCC_BY_CODE } from "@/data/mccTaxonomy";
import { MONITORING_THRESHOLD } from "@/data/generator";
import {
  mean,
  median,
  stdev,
  percentile,
  ratio,
  entropy,
  round,
} from "@/utils/stats";
import { normalizedSimilarity, ngramSimilarity, genericTokenRatio } from "@/utils/text";

const KNOWN_BRANDS = [
  "WALMART SUPERCENTER", "AMAZON", "TARGET", "COSTCO WHOLESALE", "BEST BUY",
  "HOME DEPOT", "APPLE STORE", "NETFLIX", "UBER", "STARBUCKS",
];

function isNight(ts: number): boolean {
  const h = new Date(ts).getUTCHours();
  return h >= 22 || h < 4;
}
function isWeekend(ts: number): boolean {
  const d = new Date(ts).getUTCDay();
  return d === 0 || d === 6;
}
function isRoundDollar(amt: number): boolean {
  const a = Math.abs(amt);
  return a >= 5 && a % 10 === 0;
}

export function brandMimicScore(descriptor: string): number {
  let best = 0;
  for (const brand of KNOWN_BRANDS) {
    best = Math.max(best, ngramSimilarity(descriptor, brand));
  }
  return best;
}

// Divergence between observed behavior and the DECLARED MCC's expected profile.
// Higher = observed behavior looks unlike the declared category.
export function mccDivergence(m: MerchantProfile, feats: {
  cardNotPresentRatio: number;
  nightRatio: number;
  avgTicket: number;
  disputeRate: number;
}): number {
  const def = MCC_BY_CODE[m.declaredMcc] ?? MCC_BY_CODE["5999"];
  const expCnp = 1 - def.typicalCardPresentRatio;
  const [lo, hi] = def.typicalTicketRange;
  const expTicket = Math.sqrt(Math.max(lo, 1) * Math.max(hi, lo + 1));
  const cnpGap = Math.abs(feats.cardNotPresentRatio - expCnp);
  const nightGap = Math.abs(feats.nightRatio - def.typicalNightRatio);
  const ticketGap = Math.min(1, Math.abs(Math.log((feats.avgTicket + 1) / (expTicket + 1))) / 2);
  const disputeGap = Math.min(1, Math.abs(feats.disputeRate - def.typicalDisputeRate) / 0.05);
  return round(0.4 * cnpGap + 0.3 * nightGap + 0.2 * ticketGap + 0.1 * disputeGap, 4);
}

export function computeMerchantFeatures(
  m: MerchantProfile,
  txns: Transaction[],
): MerchantFeatures {
  const approved = txns.filter((t) => t.authorizationStatus === "approved");
  const purchases = approved.filter((t) => !t.refund && t.amount > 0);
  const amounts = purchases.map((t) => t.amount);
  const n = approved.length;
  const nz = Math.max(n, 1);

  const cnpCount = approved.filter((t) => t.ecommerce).length;
  const nightCount = approved.filter((t) => isNight(t.timestamp)).length;
  const weekendCount = approved.filter((t) => isWeekend(t.timestamp)).length;
  const crossBorderCount = approved.filter((t) => t.crossBorder).length;
  const fallbackCount = approved.filter((t) => t.entryMode === "fallback").length;
  const manualCount = approved.filter((t) => t.entryMode === "manual").length;
  const refundCount = approved.filter((t) => t.refund).length;
  const reversalCount = approved.filter((t) => t.reversal).length;
  const disputeCount = approved.filter((t) => t.dispute).length;
  const notRecognizedCount = approved.filter(
    (t) => t.dispute && t.disputeReason === "merchant not recognized",
  ).length;
  const roundCount = purchases.filter((t) => isRoundDollar(t.amount)).length;
  const cashEqCount = approved.filter((t) => t.cashEquivalent).length;
  const walletCount = approved.filter((t) => t.walletLoad).length;
  const thresholdCount = purchases.filter(
    (t) => t.amount <= MONITORING_THRESHOLD && t.amount >= MONITORING_THRESHOLD * 0.9,
  ).length;

  // Cards / repeat behavior.
  const cardCounts = new Map<string, number>();
  for (const t of approved) cardCounts.set(t.cardId, (cardCounts.get(t.cardId) ?? 0) + 1);
  const uniqueCards = cardCounts.size;
  const repeatCards = [...cardCounts.values()].filter((c) => c > 1).length;

  // Rapid repeats: same card within 5 minutes at this merchant.
  const byCard = new Map<string, number[]>();
  for (const t of approved) {
    const arr = byCard.get(t.cardId) ?? [];
    arr.push(t.timestamp);
    byCard.set(t.cardId, arr);
  }
  let rapidRepeat = 0;
  for (const times of byCard.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] <= 300000) rapidRepeat++;
    }
  }

  // Descriptor stats.
  const descCounts = new Map<string, number>();
  for (const t of approved) descCounts.set(t.merchantDescriptor, (descCounts.get(t.merchantDescriptor) ?? 0) + 1);
  const descriptorCount = descCounts.size;
  const descriptorEntropy = round(entropy([...descCounts.values()]), 4);
  const descriptorNameSimilarity = round(normalizedSimilarity(m.descriptor, m.tradeName), 4);
  const brandMimic = round(brandMimicScore(m.descriptor), 4);

  // Product-signal category diversity.
  const sigCounts = new Map<string, number>();
  for (const t of approved) sigCounts.set(t.productSignal, (sigCounts.get(t.productSignal) ?? 0) + 1);
  const categoryDiversity = round(entropy([...sigCounts.values()]), 4);

  // Geo dispersion (stdev of transaction lat/long).
  const geoDispersion = round(
    stdev(approved.map((t) => t.latitude)) + stdev(approved.map((t) => t.longitude)),
    4,
  );

  // Velocity per active hour.
  const activeHours = new Set(approved.map((t) => Math.floor(t.timestamp / 3600000))).size;
  const velocity = round(ratio(n, Math.max(activeHours, 1)), 3);

  // Ticket bimodality: gap between two halves of sorted amounts (crude).
  const sorted = [...amounts].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const med = median(sorted);
  const bimodality = round(med > 0 ? Math.min(1, (q3 - q1) / (med + 1)) : 0, 4);

  // Change-point: shift in avg ticket + cnp between first and second half.
  const times = approved.map((t) => t.timestamp).sort((a, b) => a - b);
  const mid = times[Math.floor(times.length / 2)] ?? 0;
  const firstHalf = approved.filter((t) => t.timestamp < mid);
  const secondHalf = approved.filter((t) => t.timestamp >= mid);
  const cpTicket = Math.abs(
    mean(secondHalf.filter((t) => t.amount > 0).map((t) => t.amount)) -
      mean(firstHalf.filter((t) => t.amount > 0).map((t) => t.amount)),
  );
  const cpCnp = Math.abs(
    ratio(secondHalf.filter((t) => t.ecommerce).length, secondHalf.length) -
      ratio(firstHalf.filter((t) => t.ecommerce).length, firstHalf.length),
  );
  const changePointScore = round(Math.min(1, cpCnp + cpTicket / 300), 4);

  const avgTicket = round(mean(amounts), 2);
  const cardNotPresentRatio = round(ratio(cnpCount, nz), 4);
  const nightRatio = round(ratio(nightCount, nz), 4);
  const disputeRate = round(ratio(disputeCount, nz), 4);

  return {
    merchantId: m.merchantId,
    txnCount: n,
    totalVolume: round(amounts.reduce((a, b) => a + b, 0), 2),
    avgTicket,
    medianTicket: round(med, 2),
    stdTicket: round(stdev(amounts), 2),
    p95Ticket: round(percentile(sorted, 95), 2),
    roundDollarRatio: round(ratio(roundCount, Math.max(purchases.length, 1)), 4),
    ticketBimodality: bimodality,
    cardNotPresentRatio,
    crossBorderRatio: round(ratio(crossBorderCount, nz), 4),
    fallbackRatio: round(ratio(fallbackCount, nz), 4),
    manualEntryRatio: round(ratio(manualCount, nz), 4),
    nightRatio,
    weekendRatio: round(ratio(weekendCount, nz), 4),
    velocityPerActiveHour: velocity,
    refundRate: round(ratio(refundCount, nz), 4),
    reversalRate: round(ratio(reversalCount, nz), 4),
    disputeRate,
    notRecognizedDisputeRate: round(ratio(notRecognizedCount, nz), 4),
    refundAfterPurchaseRatio: round(ratio(refundCount, Math.max(purchases.length, 1)), 4),
    uniqueCardRatio: round(ratio(uniqueCards, nz), 4),
    repeatCardRatio: round(ratio(repeatCards, Math.max(uniqueCards, 1)), 4),
    rapidRepeatRatio: round(ratio(rapidRepeat, nz), 4),
    descriptorCount,
    descriptorEntropy,
    descriptorNameSimilarity,
    brandMimicScore: brandMimic,
    genericTokenRatio: round(genericTokenRatio(m.descriptor), 4),
    cashEquivalentRatio: round(ratio(cashEqCount, nz), 4),
    walletLoadRatio: round(ratio(walletCount, nz), 4),
    thresholdProximityRatio: round(ratio(thresholdCount, Math.max(purchases.length, 1)), 4),
    sharedDeviceCount: 0, // filled cross-merchant in pipeline
    sharedIpCount: 0,
    sharedBankAccountCount: 0,
    submerchantCount: 0,
    categoryDiversity,
    geoDispersion,
    mccDivergence: mccDivergence(m, { cardNotPresentRatio, nightRatio, avgTicket, disputeRate }),
    changePointScore,
    peerNightZ: 0,
    peerCnpZ: 0,
    peerTicketZ: 0,
  };
}
