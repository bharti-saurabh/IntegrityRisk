import { Rng } from "@/utils/rng";
import { MCC_TAXONOMY, MCC_BY_CODE } from "@/data/mccTaxonomy";
import { baseProfile, applyTypologyShaping, type BehaviorProfile } from "@/data/behaviorProfiles";
import { SCENARIO_SPECS, type ScenarioSpec } from "@/data/scenarios";
import type {
  MerchantProfile,
  Transaction,
  CustomerProfile,
  Typology,
  EntryMode,
} from "@/types/domain";

// Fixed anchor so the dataset is fully reproducible regardless of wall-clock.
export const DATA_ANCHOR_MS = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01
export const MONITORING_THRESHOLD = 500; // $ threshold used by split/threshold logic

export interface GenConfig {
  seed: number | string;
  merchants: number;
  targetTransactions: number;
  days: number;
  abusePrevalence: number; // 0..1 among non-scenario merchants
}

export const DEFAULT_GEN_CONFIG: GenConfig = {
  seed: "iicc-demo-v1",
  merchants: 1300,
  targetTransactions: 120000,
  days: 60,
  abusePrevalence: 0.14,
};

export interface KnownBadEntity {
  id: string;
  kind: "bank" | "ip" | "device" | "owner";
}

export interface GeneratedDataset {
  config: GenConfig;
  dataVersion: string;
  generatedAnchor: number;
  merchants: MerchantProfile[];
  transactions: Transaction[];
  customers: CustomerProfile[];
  knownBad: KnownBadEntity[];
}

const US_PLACES: [string, string, number, number][] = [
  ["Henderson", "NV", 36.03, -114.98],
  ["Tampa", "FL", 27.95, -82.46],
  ["Miami", "FL", 25.76, -80.19],
  ["Newark", "NJ", 40.74, -74.17],
  ["Wilmington", "DE", 39.74, -75.55],
  ["Houston", "TX", 29.76, -95.37],
  ["Phoenix", "AZ", 33.45, -112.07],
  ["Denver", "CO", 39.74, -104.99],
  ["Atlanta", "GA", 33.75, -84.39],
  ["Las Vegas", "NV", 36.17, -115.14],
  ["Chicago", "IL", 41.88, -87.63],
  ["Portland", "OR", 45.52, -122.68],
  ["Austin", "TX", 30.27, -97.74],
  ["Columbus", "OH", 39.96, -82.99],
  ["Seattle", "WA", 47.61, -122.33],
  ["Dallas", "TX", 32.78, -96.8],
  ["Boston", "MA", 42.36, -71.06],
  ["Detroit", "MI", 42.33, -83.05],
  ["Nashville", "TN", 36.16, -86.78],
  ["Sacramento", "CA", 38.58, -121.49],
];

const GENERIC_DESC = ["GROUP", "LLC", "SVCS", "TRADING", "GLOBAL", "ONLINE", "STORE", "CO"];
const GAMING_TERMS = ["PLAY247", "BETLINE", "SPIN", "STAKE", "JACKPOT", "WAGER"];

function pad(n: number, len: number): string {
  return n.toString().padStart(len, "0");
}

function makeDescriptor(rng: Rng, tradeName: string): string {
  const stem = tradeName.toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 14).trim();
  return rng.bool(0.7) ? stem : `${stem} ${rng.pick(GENERIC_DESC)}`;
}

function entryModeFor(rng: Rng, cnp: boolean): EntryMode {
  if (cnp) return "ecom";
  return rng.weighted<EntryMode>(
    ["chip", "contactless", "swipe", "manual", "fallback"],
    [0.55, 0.3, 0.08, 0.04, 0.03],
  );
}

interface CardRef {
  cardId: string;
  customerId: string;
  deviceId: string;
  ip: string;
  highRisk: boolean;
}

export function generateDataset(cfg: GenConfig): GeneratedDataset {
  const rng = new Rng(cfg.seed);
  const windowMs = cfg.days * 86400000;
  const windowStart = DATA_ANCHOR_MS - windowMs;

  // --- Infrastructure pools ------------------------------------------------
  const nBanks = 90;
  const nOwners = 700;
  const nDevices = 1400;
  const nIps = 1200;
  const nFacilitators = 40;
  const nAcquirers = 12;
  const banks = Array.from({ length: nBanks }, (_, i) => `BANK-${pad(i, 4)}`);
  const owners = Array.from({ length: nOwners }, (_, i) => `OWN-${pad(i, 5)}`);
  const acquirers = Array.from({ length: nAcquirers }, (_, i) => `ACQ-${pad(i, 3)}`);
  const facilitators = Array.from({ length: nFacilitators }, (_, i) => `PF-${pad(i, 3)}`);

  // Known-bad entities the graph can trace paths to.
  const knownBad: KnownBadEntity[] = [
    { id: "BANK-0007", kind: "bank" },
    { id: "IP-000042", kind: "ip" },
    { id: "DEV-00013", kind: "device" },
    { id: "OWN-00099", kind: "owner" },
  ];

  // --- Customers / cards ---------------------------------------------------
  const nCustomers = 26000;
  const customers: CustomerProfile[] = [];
  const normalCards: CardRef[] = [];
  const highRiskCards: CardRef[] = [];
  for (let i = 0; i < nCustomers; i++) {
    const highRisk = rng.bool(0.12);
    const cardId = `C-${pad(i, 6)}`;
    const customerId = `CUST-${pad(i, 6)}`;
    const deviceId = `DEV-${pad(rng.int(0, nDevices - 1), 5)}`;
    const ip = `IP-${pad(rng.int(0, nIps - 1), 6)}`;
    const ref: CardRef = { cardId, customerId, deviceId, ip, highRisk };
    (highRisk ? highRiskCards : normalCards).push(ref);
    const home = rng.pick(US_PLACES);
    customers.push({
      customerId,
      cardIds: [cardId],
      accountAgeDays: rng.int(30, 3600),
      homeGeography: `${home[0]}, ${home[1]}`,
      normalSpendCategories: rng.shuffle(MCC_TAXONOMY.map((m) => m.code)).slice(0, 3),
      typicalTicket: Math.round(rng.float(15, 160)),
      transactionFrequency: rng.int(2, 40),
      householdId: `HH-${pad(Math.floor(i / 2), 6)}`,
      businessCard: rng.bool(0.15),
      riskSegment: highRisk
        ? "high-risk"
        : rng.weighted(["prime", "near-prime", "thin-file"], [0.6, 0.3, 0.1]),
    });
  }
  const pickCard = (affinity: number): CardRef => {
    if (highRiskCards.length && rng.next() < affinity) return rng.pick(highRiskCards);
    return rng.pick(normalCards);
  };

  // --- Merchants -----------------------------------------------------------
  const merchants: MerchantProfile[] = [];
  const scenarioById = new Map(SCENARIO_SPECS.map((s) => [s.merchantId, s]));
  const nonScenarioCount = cfg.merchants - SCENARIO_SPECS.length;

  const buildMerchant = (
    id: string,
    declaredMcc: string,
    actualMcc: string,
    typology: Typology,
    spec?: ScenarioSpec,
  ): MerchantProfile => {
    const place = spec
      ? US_PLACES.find((p) => p[0] === spec.city) ?? rng.pick(US_PLACES)
      : rng.pick(US_PLACES);
    const def = MCC_BY_CODE[actualMcc];
    const cnp = spec?.overrides?.crossBorderMask
      ? 0.95
      : Math.min(0.99, 1 - def.typicalCardPresentRatio + rng.float(-0.05, 0.05));
    const isFacil = spec?.overrides?.submerchantCount ? true : rng.bool(0.05);
    const trade = spec?.tradeName ?? `${rng.pick(SYN_PREFIX)} ${rng.pick(SYN_SUFFIX)}`;
    const legal = spec?.legalName ?? `${trade} ${rng.pick(["LLC", "Inc", "Group LLC", "Holdings"])}`;
    const onboardDays = spec?.overrides?.coldStart ? rng.int(3, 12) : rng.int(40, 2400);
    return {
      merchantId: id,
      legalName: legal,
      tradeName: trade,
      descriptor: spec?.descriptor ?? makeDescriptor(rng, trade),
      alternateDescriptors: [],
      declaredMcc,
      actualBusinessMcc: actualMcc,
      businessCategory: MCC_BY_CODE[declaredMcc].category,
      merchantType: isFacil ? "facilitator" : "standard",
      paymentFacilitatorId: rng.bool(0.35) ? rng.pick(facilitators) : null,
      acquirerId: rng.pick(acquirers),
      parentMerchantId: null,
      onboardingDate: new Date(DATA_ANCHOR_MS - onboardDays * 86400000).toISOString().slice(0, 10),
      country: "US",
      state: place[1],
      city: place[0],
      latitude: place[2],
      longitude: place[3],
      websiteDomain: `${trade.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
      cardPresentRatio: 1 - cnp,
      cardNotPresentRatio: cnp,
      averageTicket: 0, // filled after txn generation
      expectedTicketRange: MCC_BY_CODE[declaredMcc].typicalTicketRange,
      annualVolume: 0,
      registeredAddressId: `ADDR-${pad(rng.int(0, 1500), 5)}`,
      settlementBankAccountId: rng.pick(banks),
      beneficialOwnerId: rng.pick(owners),
      customerSupportPhone: `+1-${rng.int(200, 989)}-${pad(rng.int(0, 999), 3)}-${pad(rng.int(0, 9999), 4)}`,
      deviceIds: [],
      ipClusterIds: [],
      groundTruthTypology: typology,
      groundTruthAbuseFlag: typology !== "CLEAN",
    };
  };

  // Scenario merchants first (fixed IDs).
  for (const spec of SCENARIO_SPECS) {
    const m = buildMerchant(
      spec.merchantId,
      spec.declaredMcc,
      spec.actualMcc,
      spec.primaryTypology as Typology,
      spec,
    );
    merchants.push(m);
  }

  // Filler merchants.
  const usableIds = new Set(merchants.map((m) => m.merchantId));
  let idCounter = 10000;
  for (let i = 0; i < nonScenarioCount; i++) {
    let id = `M-${idCounter++}`;
    while (usableIds.has(id)) id = `M-${idCounter++}`;
    usableIds.add(id);
    const abusive = rng.next() < cfg.abusePrevalence;
    let declaredMcc = rng.pick(MCC_TAXONOMY).code;
    let actualMcc = declaredMcc;
    let typology: Typology = "CLEAN";
    if (abusive) {
      typology = rng.weighted<Typology>(
        ["MCC_MISCODING", "SPLIT_TICKETING", "FACTORING", "FAKE_DESCRIPTOR", "CASH_DISBURSEMENT"],
        [0.34, 0.16, 0.18, 0.14, 0.18],
      );
      // low-risk declared MCC hiding higher-risk actual behavior
      declaredMcc = rng.pick(["5411", "5812", "5499", "5999", "5734", "8999"]);
      if (typology === "MCC_MISCODING")
        actualMcc = rng.pick(["7995", "6051", "5813", "5967", "7273", "7372"]);
      else if (typology === "CASH_DISBURSEMENT") actualMcc = "6051";
      else actualMcc = declaredMcc;
    } else {
      declaredMcc = rng.pick(MCC_TAXONOMY).code;
      actualMcc = declaredMcc;
    }
    merchants.push(buildMerchant(id, declaredMcc, actualMcc, typology));
  }

  // --- Transaction generation ---------------------------------------------
  const transactions: Transaction[] = [];
  // Allocate a per-merchant txn budget so the total lands near target.
  const rawWeights = merchants.map(() => rng.logNormal(0, 0.8));
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  const scale = cfg.targetTransactions / weightSum;

  let txnSeq = 0;
  merchants.forEach((m, idx) => {
    const spec = scenarioById.get(m.merchantId);
    let profile = applyTypologyShaping(
      baseProfile(m.actualBusinessMcc),
      m.groundTruthTypology,
      spec?.overrides as Record<string, unknown> | undefined,
    );
    if (spec?.overrides?.crossBorderMask) profile = { ...profile, crossBorderRatio: 0.72 };
    let count = Math.max(6, Math.round(rawWeights[idx] * scale));
    if (spec?.overrides?.coldStart) count = rng.int(7, 16);
    if (spec) count = Math.max(count, 80); // ensure showcase merchants have depth

    const descPool = buildDescriptorPool(rng, m, profile.descriptorPoolSize, spec);
    m.alternateDescriptors = descPool.slice(1);
    const deviceSet = new Set<string>();
    const ipSet = new Set<string>();

    const changePointAt = spec?.overrides?.changePoint ? windowStart + windowMs * 0.55 : null;

    let generated = 0;
    while (generated < count) {
      // Split-ticket clusters: emit a burst of near-threshold txns together.
      const doSplit =
        (m.groundTruthTypology === "SPLIT_TICKETING" || spec?.overrides?.thresholdAvoid) &&
        rng.bool(m.merchantId === "M-15884" ? 0.5 : 0.25);
      if (doSplit && count - generated >= 4) {
        const clusterId = `CL-${m.merchantId}-${generated}`;
        const card = pickCard(0.2);
        const clusterStart = windowStart + rng.float(0, windowMs);
        const parts = rng.int(4, 6);
        for (let k = 0; k < parts; k++) {
          const amt = MONITORING_THRESHOLD - rng.float(2, 45);
          transactions.push(
            makeTxn(rng, txnSeq++, m, profile, descPool, card, {
              tsOverride: clusterStart + k * rng.float(45000, 130000),
              amountOverride: Math.round(amt * 100) / 100,
              clusterId,
            }),
          );
          deviceSet.add(card.deviceId);
          ipSet.add(card.ip);
        }
        generated += parts;
        continue;
      }

      const card = pickCard(profile.highRiskCustomerAffinity);
      let ts = windowStart + rng.float(0, windowMs);
      // Seasonal spike toward the end of the window.
      if (spec?.overrides?.seasonal && rng.bool(0.5)) ts = windowStart + windowMs * rng.float(0.7, 1);
      // Change point: after change, behave like a riskier profile.
      let effProfile = profile;
      if (changePointAt && ts > changePointAt) {
        effProfile = {
          ...profile,
          disputeRate: 0.07,
          cnpRatio: 0.9,
          roundDollarProb: 0.3,
          nightRatio: 0.4,
        };
      }
      const txn = makeTxn(rng, txnSeq++, m, effProfile, descPool, card, {});
      // Refund-after-purchase: emit a paired refund shortly after.
      transactions.push(txn);
      deviceSet.add(card.deviceId);
      ipSet.add(card.ip);
      generated++;
      if (rng.next() < effProfile.refundAfterProb && generated < count) {
        const refund = makeTxn(rng, txnSeq++, m, effProfile, descPool, card, {
          tsOverride: txn.timestamp + rng.float(60000, 900000),
          amountOverride: Math.round(txn.amount * rng.float(0.4, 1) * 100) / 100,
          refundOf: txn.transactionId,
        });
        transactions.push(refund);
        generated++;
      }
    }
    m.deviceIds = Array.from(deviceSet).slice(0, 12);
    m.ipClusterIds = Array.from(ipSet).slice(0, 12);
  });

  // Wire shared infrastructure + known-bad adjacency for factoring scenarios.
  wireSharedInfrastructure(merchants, knownBad);

  return {
    config: cfg,
    dataVersion: `synthetic-${cfg.seed}-m${cfg.merchants}-t${transactions.length}`,
    generatedAnchor: DATA_ANCHOR_MS,
    merchants,
    transactions,
    customers,
    knownBad,
  };
}

const SYN_PREFIX = [
  "Summit", "Harbor", "Cedar", "Vertex", "Union", "Copper", "Willow", "Granite",
  "Silver", "Metro", "Coastal", "Prairie", "Ridge", "Lakeside", "Riverside",
];
const SYN_SUFFIX = [
  "Provisions", "Retail", "Kitchen", "Services", "Digital", "Trading", "Supply",
  "Mercantile", "Foods", "Outfitters", "Ventures", "Goods", "Studio", "Depot",
];

function buildDescriptorPool(
  rng: Rng,
  m: MerchantProfile,
  size: number,
  spec?: ScenarioSpec,
): string[] {
  const pool = [m.descriptor];
  if (spec?.overrides?.brandMimic) {
    pool[0] = m.descriptor; // mimic descriptor is the primary
  }
  for (let i = 1; i < size; i++) {
    pool.push(`${rng.pick(SYN_PREFIX).toUpperCase()} ${rng.pick(GENERIC_DESC)}`);
  }
  return pool;
}

interface TxnOpts {
  tsOverride?: number;
  amountOverride?: number;
  clusterId?: string;
  refundOf?: string;
}

function makeTxn(
  rng: Rng,
  seq: number,
  m: MerchantProfile,
  p: BehaviorProfile,
  descPool: string[],
  card: CardRef,
  opts: TxnOpts,
): Transaction {
  const ts = opts.tsOverride ?? DATA_ANCHOR_MS - rng.float(0, 60 * 86400000);
  const cnp = rng.next() < p.cnpRatio;
  let amount = opts.amountOverride ?? Math.round(rng.logNormal(p.ticketMu, p.ticketSigma) * 100) / 100;
  if (opts.amountOverride == null && rng.next() < p.roundDollarProb) {
    amount = Math.max(5, Math.round(amount / 10) * 10);
  }
  const isRefund = opts.refundOf != null;
  const crossBorder = !isRefund && rng.next() < p.crossBorderRatio;
  const cashEq = !isRefund && rng.next() < p.cashEquivRatio;
  const walletLoad = !isRefund && rng.next() < p.walletLoadRatio;
  const disputed = !isRefund && rng.next() < p.disputeRate;
  const notRecognized = disputed && rng.next() < p.notRecognizedShare;
  const keyword = pickProductSignal(rng, p, m);
  const declined = rng.next() < 0.03;
  // Nudge timestamp into night window with probability nightRatio.
  let finalTs = ts;
  if (opts.tsOverride == null && rng.next() < p.nightRatio) {
    const nightHour = rng.pick([22, 23, 0, 1, 2, 3]);
    const d = new Date(ts);
    d.setUTCHours(nightHour, rng.int(0, 59), 0, 0);
    finalTs = d.getTime();
  }

  return {
    transactionId: `T-${pad(seq, 8)}`,
    timestamp: finalTs,
    merchantId: m.merchantId,
    cardId: card.cardId,
    customerId: card.customerId,
    amount: isRefund ? -Math.abs(amount) : amount,
    currency: "USD",
    declaredMcc: m.declaredMcc,
    merchantDescriptor: descPool.length > 1 ? rng.pick(descPool) : m.descriptor,
    authorizationStatus: declined ? "declined" : "approved",
    entryMode: entryModeFor(rng, cnp),
    cardPresent: !cnp,
    ecommerce: cnp,
    recurring: rng.bool(0.08),
    crossBorder,
    cardCountry: crossBorder ? rng.pick(["GB", "MT", "CW", "PA", "CY"]) : "US",
    merchantCountry: "US",
    deviceId: card.deviceId,
    ipAddress: card.ip,
    latitude: m.latitude + rng.float(-0.4, 0.4),
    longitude: m.longitude + rng.float(-0.4, 0.4),
    terminalId: `TERM-${m.merchantId}-${rng.int(1, 4)}`,
    authorizationCode: pad(rng.int(0, 999999), 6),
    originalTransactionId: opts.refundOf ?? null,
    refund: isRefund,
    reversal: !isRefund && rng.bool(0.01),
    dispute: disputed,
    disputeReason: notRecognized
      ? "merchant not recognized"
      : disputed
        ? rng.pick(["product not received", "unauthorized", "duplicate"])
        : null,
    cashEquivalent: cashEq,
    walletLoad,
    productSignal: keyword,
    transactionClusterId: opts.clusterId ?? null,
    groundTruthTypology: m.groundTruthTypology,
  };
}

function pickProductSignal(rng: Rng, p: BehaviorProfile, m: MerchantProfile): string {
  if (m.actualBusinessMcc === "7995" && rng.bool(0.5)) return rng.pick(GAMING_TERMS).toLowerCase();
  if (m.actualBusinessMcc === "6051" && rng.bool(0.5))
    return rng.pick(["wallet-load", "topup", "reload", "cash-equivalent"]);
  return rng.pick(p.productKeywords);
}

// Force a handful of factoring scenarios to share settlement banks / devices /
// IPs with the known-bad entities so the graph has traceable paths.
function wireSharedInfrastructure(merchants: MerchantProfile[], knownBad: KnownBadEntity[]): void {
  const badBank = knownBad.find((k) => k.kind === "bank")!.id;
  const badIp = knownBad.find((k) => k.kind === "ip")!.id;
  const badDev = knownBad.find((k) => k.kind === "device")!.id;
  const badOwner = knownBad.find((k) => k.kind === "owner")!.id;
  const factoring = merchants.filter(
    (m) => m.groundTruthTypology === "FACTORING" || m.merchantId === "M-16999",
  );
  factoring.forEach((m, i) => {
    if (i % 2 === 0) m.settlementBankAccountId = badBank;
    if (i % 3 === 0) m.beneficialOwnerId = badOwner;
    if (!m.ipClusterIds.includes(badIp)) m.ipClusterIds = [badIp, ...m.ipClusterIds].slice(0, 12);
    if (!m.deviceIds.includes(badDev)) m.deviceIds = [badDev, ...m.deviceIds].slice(0, 12);
  });
}
