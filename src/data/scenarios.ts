import type { DemoScenario, Typology } from "@/types/domain";

// Fixed showcase merchants. The generator gives each of these merchant IDs a
// deterministic, recognizable behavioral signature so the guided demo and the
// flagship investigations are always reproducible.
export interface ScenarioSpec extends DemoScenario {
  /** MCC the merchant is registered under. */
  declaredMcc: string;
  /** The business it actually behaves like (drives transaction generation). */
  actualMcc: string;
  legalName: string;
  tradeName: string;
  descriptor: string;
  city: string;
  state: string;
  /** Optional generation overrides layered on top of the actualMcc profile. */
  overrides?: Partial<{
    descriptorCount: number;
    submerchantCount: number;
    brandMimic: string;
    thresholdAvoid: number;
    roundDollar: number;
    walletLoad: number;
    refundAfter: number;
    sharedInfra: boolean;
    changePoint: boolean;
    seasonal: boolean;
    coldStart: boolean;
    falsePositive: boolean;
    crossBorderMask: boolean;
  }>;
}

export const SCENARIO_SPECS: ScenarioSpec[] = [
  {
    scenarioId: "mcc-gambling-hidden-as-grocery",
    merchantId: "M-10482",
    title: "Gambling activity concealed under grocery MCC",
    primaryTypology: "MCC_MISCODING",
    story:
      "Declared as a neighborhood grocery store but behaving like a digital gambling operator — near-total card-not-present mix, late-night deposit-like amounts, and gaming terminology in product signals.",
    expectedSignals: [
      "late-night transaction concentration",
      "high card-not-present ratio",
      "repeated small deposit-like amounts",
      "high velocity",
      "descriptor terms associated with gaming",
      "customer overlap with known gambling merchants",
    ],
    declaredMcc: "5411",
    actualMcc: "7995",
    legalName: "Northgate Fresh Provisions LLC",
    tradeName: "Northgate Fresh Market",
    descriptor: "NGATE MKT PLAY247",
    city: "Henderson",
    state: "NV",
  },
  {
    scenarioId: "cash-disbursement-restaurant",
    merchantId: "M-11731",
    title: "Restaurant MCC used for cash-disbursement patterns",
    primaryTypology: "CASH_DISBURSEMENT",
    story:
      "Coded as an eating place but exhibiting ATM-like behavior: repeated round-dollar charges immediately followed by partial refunds and high same-card velocity.",
    expectedSignals: [
      "round-dollar concentration",
      "refund-after-purchase pattern",
      "same-card repeat velocity",
      "threshold avoidance",
    ],
    declaredMcc: "5812",
    actualMcc: "6051",
    legalName: "Blue Harbor Dining Group Inc",
    tradeName: "Blue Harbor Grill",
    descriptor: "BLUEHARBOR GRILL",
    city: "Tampa",
    state: "FL",
    overrides: { roundDollar: 0.72, refundAfter: 0.4, walletLoad: 0.5 },
  },
  {
    scenarioId: "profservices-as-nightclub",
    merchantId: "M-12902",
    title: "Professional-services business operating as a nightclub",
    primaryTypology: "MCC_MISCODING",
    story:
      "Registered as professional consulting services but with nightclub-like timing — heavy late-night, weekend-concentrated, card-present bar tabs.",
    expectedSignals: [
      "extreme nighttime concentration",
      "weekend concentration",
      "bar-sized ticket distribution",
      "card-present venue behavior",
    ],
    declaredMcc: "8999",
    actualMcc: "5813",
    legalName: "Meridian Advisory Partners LLC",
    tradeName: "Meridian Partners",
    descriptor: "MERIDIAN LOUNGE",
    city: "Miami",
    state: "FL",
  },
  {
    scenarioId: "convenience-wallet-loading",
    merchantId: "M-13440",
    title: "Convenience store used for wallet loading",
    primaryTypology: "CASH_DISBURSEMENT",
    story:
      "Convenience-store MCC with unusually high card-not-present volume and stored-value / wallet-loading indicators inconsistent with a corner store.",
    expectedSignals: [
      "high card-not-present for convenience MCC",
      "wallet-load indicators",
      "large round-dollar loads",
      "repeat-card concentration",
    ],
    declaredMcc: "5499",
    actualMcc: "6051",
    legalName: "QuickStop Retail Ventures LLC",
    tradeName: "QuickStop Corner",
    descriptor: "QUICKSTOP TOPUP",
    city: "Newark",
    state: "NJ",
    overrides: { walletLoad: 0.62, roundDollar: 0.55 },
  },
  {
    scenarioId: "facilitator-undisclosed-submerchants",
    merchantId: "M-14005",
    title: "Payment facilitator with undisclosed high-risk submerchants",
    primaryTypology: "FACTORING",
    story:
      "A payment facilitator whose submerchants inherit a low-risk MCC while several undisclosed submerchants process high-risk digital goods through shared infrastructure.",
    expectedSignals: [
      "many submerchant identities",
      "shared bank account and IP infrastructure",
      "mixed unrelated categories",
      "high-risk entity adjacency",
    ],
    declaredMcc: "5999",
    actualMcc: "5999",
    legalName: "PayBridge Aggregation Services Inc",
    tradeName: "PayBridge",
    descriptor: "PAYBRIDGE*VARIES",
    city: "Wilmington",
    state: "DE",
    overrides: { submerchantCount: 9, sharedInfra: true, descriptorCount: 7 },
  },
  {
    scenarioId: "factoring-six-descriptors",
    merchantId: "M-14571",
    title: "Merchant with six unrelated descriptors",
    primaryTypology: "FACTORING",
    story:
      "A single merchant ID processing under six unrelated descriptors spanning multiple business categories — a classic transaction-laundering signature.",
    expectedSignals: [
      "high descriptor entropy",
      "unrelated category mix",
      "geographically dispersed customers",
      "sudden category shifts",
    ],
    declaredMcc: "5999",
    actualMcc: "5999",
    legalName: "Apex Commerce Solutions LLC",
    tradeName: "Apex Commerce",
    descriptor: "APEX*MULTI",
    city: "Houston",
    state: "TX",
    overrides: { descriptorCount: 6, sharedInfra: true },
  },
  {
    scenarioId: "card-surcharge-over-cap",
    merchantId: "M-15220",
    title: "Card surcharge over the cap, disputed as unrecognized",
    primaryTypology: "CARD_SURCHARGE",
    story:
      "A checkout fee is added to card payments above the brand cost-of-acceptance cap, applied to debit and prepaid where it is prohibited, and not disclosed at the point of sale — so cardholders don't recognize the extra charge and dispute it as unauthorized.",
    expectedSignals: [
      "surcharge above the cost-of-acceptance cap",
      "surcharge on prohibited debit / prepaid",
      "no point-of-sale disclosure",
      "high 'not recognized' unexpected-fee dispute rate",
    ],
    declaredMcc: "5999",
    actualMcc: "5999",
    legalName: "Sterling Retail Group LLC",
    tradeName: "Sterling Home & Electronics",
    descriptor: "STERLING HOME ELEC",
    city: "Phoenix",
    state: "AZ",
  },
  {
    scenarioId: "split-ticketing-threshold",
    merchantId: "M-15884",
    title: "Merchant splitting purchases just below a monitoring threshold",
    primaryTypology: "SPLIT_TICKETING",
    story:
      "Large purchases are repeatedly divided into clusters of smaller transactions on the same card and device within minutes, each just under a configured threshold.",
    expectedSignals: [
      "tight transaction clusters",
      "amounts just below threshold",
      "same card/device/location",
      "combined value far above threshold",
    ],
    declaredMcc: "5999",
    actualMcc: "5999",
    legalName: "Highland Electronics Outlet LLC",
    tradeName: "Highland Electronics",
    descriptor: "HIGHLAND ELEC",
    city: "Denver",
    state: "CO",
    overrides: { thresholdAvoid: 0.7 },
  },
  {
    scenarioId: "cash-round-dollar-refund",
    merchantId: "M-16340",
    title: "Rapid round-dollar transactions and refunds",
    primaryTypology: "CASH_DISBURSEMENT",
    story:
      "Rapid sequences of round-dollar purchases followed by immediate refunds across a small set of repeat cards — a cash-equivalent extraction pattern.",
    expectedSignals: [
      "round-dollar ratio",
      "rapid purchase/refund cycles",
      "repeat-card velocity",
      "same-day spend and reversal",
    ],
    declaredMcc: "5999",
    actualMcc: "6051",
    legalName: "Vantage Goods Trading LLC",
    tradeName: "Vantage Goods",
    descriptor: "VANTAGE GOODS",
    city: "Atlanta",
    state: "GA",
    overrides: { roundDollar: 0.8, refundAfter: 0.55 },
  },
  {
    scenarioId: "shared-infra-banned-entities",
    merchantId: "M-16999",
    title: "Merchant sharing bank account and IP with banned entities",
    primaryTypology: "FACTORING",
    story:
      "Shares a settlement bank account, device fingerprint, and IP range with previously terminated high-risk entities — visible only through the entity graph.",
    expectedSignals: [
      "shared settlement account with known-bad",
      "shared IP / device with terminated merchants",
      "short path to known-bad entity",
      "elevated community risk",
    ],
    declaredMcc: "5999",
    actualMcc: "5967",
    legalName: "Cobalt Merchant Services LLC",
    tradeName: "Cobalt Merchant",
    descriptor: "COBALT SVCS",
    city: "Las Vegas",
    state: "NV",
    overrides: { sharedInfra: true },
  },
  {
    scenarioId: "clean-false-positive",
    merchantId: "M-17500",
    title: "Clean merchant flagged by a rule but cleared by ML",
    primaryTypology: "CLEAN",
    story:
      "A legitimate 24-hour pharmacy that trips a naive night-ratio rule, but the ML ensemble and peer comparison clear it — the demo's false-positive case.",
    expectedSignals: [
      "elevated night ratio (legitimate 24h operation)",
      "consistent single category",
      "stable descriptor",
      "low dispute rate",
    ],
    declaredMcc: "5912",
    actualMcc: "5912",
    legalName: "CityCare 24hr Pharmacy Inc",
    tradeName: "CityCare Pharmacy",
    descriptor: "CITYCARE PHARMACY",
    city: "Chicago",
    state: "IL",
    overrides: { falsePositive: true },
  },
  {
    scenarioId: "cold-start-new-merchant",
    merchantId: "M-18010",
    title: "New merchant with cold-start risk",
    primaryTypology: "CLEAN",
    story:
      "Onboarded days ago with thin history — the model expresses high uncertainty rather than a confident score. Demonstrates cold-start handling.",
    expectedSignals: [
      "very short history",
      "few transactions",
      "wide confidence band",
      "insufficient evidence for a determination",
    ],
    declaredMcc: "5812",
    actualMcc: "5812",
    legalName: "Rosewood Cafe & Bakery LLC",
    tradeName: "Rosewood Cafe",
    descriptor: "ROSEWOOD CAFE",
    city: "Portland",
    state: "OR",
    overrides: { coldStart: true },
  },
  {
    scenarioId: "business-changed-over-time",
    merchantId: "M-18450",
    title: "Merchant whose business changed over time",
    primaryTypology: "MCC_MISCODING",
    story:
      "Began as a legitimate software store, then shifted mid-window toward high-risk digital-goods behavior without updating its MCC — a change-point signature.",
    expectedSignals: [
      "change-point in behavior",
      "pre/post ticket and channel shift",
      "rising dispute rate",
      "MCC no longer matches recent behavior",
    ],
    declaredMcc: "5734",
    actualMcc: "5967",
    legalName: "Pixel Forge Software LLC",
    tradeName: "Pixel Forge",
    descriptor: "PIXELFORGE",
    city: "Austin",
    state: "TX",
    overrides: { changePoint: true },
  },
  {
    scenarioId: "seasonal-legitimate-spike",
    merchantId: "M-18920",
    title: "Seasonal merchant with legitimate behavior spikes",
    primaryTypology: "CLEAN",
    story:
      "A legitimate garden retailer with a strong seasonal volume spike that a naive velocity rule mistakes for abuse but peer-adjusted models accept.",
    expectedSignals: [
      "seasonal volume spike",
      "consistent category and descriptor",
      "peer-normal dispute and refund rates",
      "no infrastructure sharing",
    ],
    declaredMcc: "5999",
    actualMcc: "5999",
    legalName: "Green Meadow Garden Supply Inc",
    tradeName: "Green Meadow Garden",
    descriptor: "GREENMEADOW GARDEN",
    city: "Columbus",
    state: "OH",
    overrides: { seasonal: true, falsePositive: true },
  },
  {
    scenarioId: "crossborder-location-mask",
    merchantId: "M-19388",
    title: "Cross-border digital merchant masking location",
    primaryTypology: "MCC_MISCODING",
    story:
      "A digital-goods merchant presenting as domestic retail while the majority of activity is cross-border card-not-present with location-masking IP behavior.",
    expectedSignals: [
      "high cross-border ratio",
      "IP/geo mismatch",
      "digital-goods ticket pattern under retail MCC",
      "elevated dispute rate",
    ],
    declaredMcc: "5999",
    actualMcc: "7372",
    legalName: "Orbit Media Retail LLC",
    tradeName: "Orbit Media",
    descriptor: "ORBIT MEDIA RTL",
    city: "Seattle",
    state: "WA",
    overrides: { crossBorderMask: true },
  },
];

export const SCENARIO_MERCHANT_IDS = new Set(SCENARIO_SPECS.map((s) => s.merchantId));

export function scenarioForMerchant(merchantId: string): ScenarioSpec | undefined {
  return SCENARIO_SPECS.find((s) => s.merchantId === merchantId);
}

export const DEMO_SCENARIOS: DemoScenario[] = SCENARIO_SPECS.map((s) => ({
  scenarioId: s.scenarioId,
  merchantId: s.merchantId,
  title: s.title,
  primaryTypology: s.primaryTypology as Typology,
  story: s.story,
  expectedSignals: s.expectedSignals,
}));
