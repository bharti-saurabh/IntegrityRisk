import {
  MISCODING_CATEGORIES,
  CNP, QUASI, ROUND, RECUR, XBORDER, CB, REFUND, TICKET, DESC, SUBMERCH,
  SURCH_RATE, SURCH_PCT,
  type MiscodingCategory,
} from "./miscodingCategories";

// ---------------------------------------------------------------------------
// Typology console configuration.
//
// Every integrity typology is one "detection-model console": pick an
// identification type from the dropdown → pull the cohort of merchants that
// behave like it but are declared under an innocuous code → work the remediation
// queue. The flagship (MCC Miscoding) is the reference; the other five families
// reuse the exact same console with a family-specific catalog + framing copy.
//
// A `DetectionModel` is MiscodingCategory-shaped so the shared EvidencePanel,
// peer-deviation viz and agent adapters consume it unchanged. `key` matches
// ExplorerMerchant.top_category; `family` (below) matches ExplorerMerchant.family.
// ---------------------------------------------------------------------------

export type DetectionModel = MiscodingCategory;

export interface TypologyConfig {
  family: string; // ExplorerMerchant.family
  route: string; // base route, e.g. "/factoring"
  title: string;
  icon: string; // lucide name
  subtitle: string;
  accent: "cyan" | "amber" | "violet" | "critical";
  /** How the dropdown phrases each model, e.g. "miscoded", "factored". */
  cohortSuffix: string;
  /** Verb for the model-output line, e.g. "behave like", "structure txns like". */
  behaveVerb: string;
  /** What the merchant is declared as, e.g. "a benign MCC". */
  declaredKind: string;
  models: DetectionModel[];
}

// ---- MCC Miscoding (flagship) ---------------------------------------------
export const MISCODING_CONFIG: TypologyConfig = {
  family: "mcc_miscoding",
  route: "/mcc",
  title: "MCC Miscoding — Identification models",
  icon: "ScanSearch",
  subtitle:
    "One detection model per prohibited/restricted category. Pick an identification type to pull the cohort of merchants that behave like it but are declared under a benign MCC — a ready-to-work remediation queue.",
  accent: "cyan",
  cohortSuffix: "miscoded",
  behaveVerb: "behave like",
  declaredKind: "a benign MCC",
  models: MISCODING_CATEGORIES,
};

// ---- MCC Abuse (interchange abuse) ----------------------------------------
export const MCC_ABUSE_CONFIG: TypologyConfig = {
  family: "mcc_abuse",
  route: "/mcc-abuse",
  title: "MCC Abuse — Interchange integrity models",
  icon: "Receipt",
  subtitle:
    "Detects merchants coded to capture a lower interchange rate than their real activity warrants. Pick a model to pull the cohort transacting like a higher-cost category while declared under a cheaper MCC.",
  accent: "amber",
  cohortSuffix: "interchange-abused",
  behaveVerb: "transact like",
  declaredKind: "a low-interchange MCC",
  models: [
    { key: "telemarketing", subtype: "Telemarketing", short: "Telemarketing", priority: "P3", owner: "Interchange integrity review",
      behavesLike: "an outbound telemarketing operation on a retail rate", signals: [CNP, CB, DESC] },
    { key: "dating_escort", subtype: "Dating & escort", short: "Dating/escort", priority: "P1", owner: "Interchange integrity review",
      behavesLike: "a dating & escort service on a retail rate", signals: [CNP, CB, REFUND] },
    { key: "nutra_subscription", subtype: "Nutra subscriptions", short: "Nutra", priority: "P3", owner: "Interchange integrity review",
      behavesLike: "a nutra free-trial biller on a retail rate", signals: [RECUR, REFUND, CB] },
  ],
};

// ---- Split-ticketing ------------------------------------------------------
export const SPLIT_CONFIG: TypologyConfig = {
  family: "split_ticketing",
  route: "/split",
  title: "Split-Ticketing — Structuring models",
  icon: "Split",
  subtitle:
    "Detects merchants breaking single purchases into multiple smaller charges to stay under monitoring and authorization thresholds. Pick a model to pull the cohort structuring transactions to evade limits.",
  accent: "amber",
  cohortSuffix: "split",
  behaveVerb: "structure transactions like",
  declaredKind: "a single-purchase MCC",
  models: [
    { key: "game_of_skill", subtype: "Game of skill", short: "Skill gaming", priority: "P2", owner: "Structuring / limits review",
      behavesLike: "a game-of-skill operator splitting entry fees", signals: [ROUND, CNP, QUASI] },
    { key: "crypto_cash", subtype: "Crypto / quasi-cash", short: "Crypto", priority: "P2", owner: "Structuring / limits review",
      behavesLike: "a crypto desk splitting large buys under limits", signals: [ROUND, QUASI, CNP] },
    { key: "nutra_subscription", subtype: "Nutra subscriptions", short: "Nutra", priority: "P3", owner: "Structuring / limits review",
      behavesLike: "a nutra biller splitting charges across a card", signals: [ROUND, RECUR, CNP] },
  ],
};

// ---- Factoring / transaction laundering -----------------------------------
export const FACTORING_CONFIG: TypologyConfig = {
  family: "factoring",
  route: "/factoring",
  title: "Factoring — Transaction-laundering models",
  icon: "Share2",
  subtitle:
    "Detects merchants processing another entity's card volume through their own MID (factoring / transaction laundering). Pick a model to pull the cohort funnelling third-party, higher-risk volume under a clean acquirer relationship.",
  accent: "critical",
  cohortSuffix: "factored",
  behaveVerb: "process third-party volume like",
  declaredKind: "a single-merchant MCC",
  models: [
    { key: "pharma", subtype: "Pharma", short: "Pharma", priority: "P1", owner: "Transaction-laundering investigations",
      behavesLike: "an unlicensed pharmacy laundering via a factoring MID", signals: [SUBMERCH, DESC, XBORDER, CNP] },
    { key: "adult", subtype: "Adult content", short: "Adult", priority: "P1", owner: "Transaction-laundering investigations",
      behavesLike: "an adult operator factoring volume through a clean MID", signals: [SUBMERCH, CNP, DESC] },
    { key: "crypto_cash", subtype: "Crypto / quasi-cash", short: "Crypto", priority: "P2", owner: "Transaction-laundering investigations",
      behavesLike: "a crypto desk factoring buys through a clean MID", signals: [SUBMERCH, QUASI, XBORDER] },
    { key: "nutra_subscription", subtype: "Nutra subscriptions", short: "Nutra", priority: "P3", owner: "Transaction-laundering investigations",
      behavesLike: "a nutra biller factoring subscription volume", signals: [SUBMERCH, DESC, RECUR] },
  ],
};

// ---- Card-surcharge abuse -------------------------------------------------
export const SURCHARGE_CONFIG: TypologyConfig = {
  family: "surcharge",
  route: "/surcharge",
  title: "Card-Surcharge Abuse — Fee-integrity models",
  icon: "BadgePercent",
  subtitle:
    "Detects merchants adding a card surcharge that breaks the brand and statutory rules — over the jurisdiction's cost-of-acceptance cap, on prohibited debit/prepaid, in a ban jurisdiction, or without point-of-sale disclosure. Pick a model to pull the cohort and read each merchant's compliance matrix against its local regime.",
  accent: "violet",
  cohortSuffix: "over-surcharging",
  behaveVerb: "surcharge in a way that",
  declaredKind: "a no-surcharge attestation",
  models: [
    { key: "surcharge_over_cap", subtype: "Over-cap surcharge", short: "Over-cap", priority: "P2", owner: "Fee-integrity / brand-rules review",
      behavesLike: "exceeds the cost-of-acceptance cap", signals: [SURCH_RATE, SURCH_PCT, CB] },
    { key: "surcharge_prohibited", subtype: "Prohibited debit/prepaid", short: "Debit/prepaid", priority: "P1", owner: "Fee-integrity / brand-rules review",
      behavesLike: "hits prohibited debit & prepaid cards", signals: [SURCH_PCT, CB, REFUND] },
    { key: "surcharge_undisclosed", subtype: "Undisclosed surcharge", short: "Undisclosed", priority: "P2", owner: "Fee-integrity / brand-rules review",
      behavesLike: "carries no point-of-sale disclosure", signals: [SURCH_RATE, CB, REFUND] },
  ],
};

// ---- Cash disbursement ----------------------------------------------------
export const CASH_CONFIG: TypologyConfig = {
  family: "cash",
  route: "/cash",
  title: "Cash-Disbursement — Quasi-cash models",
  icon: "Banknote",
  subtitle:
    "Detects merchants disbursing cash or quasi-cash under a retail MCC (unlicensed cash access). Pick a model to pull the cohort moving cash-equivalent value while coded as ordinary retail.",
  accent: "critical",
  cohortSuffix: "cash-out",
  behaveVerb: "disburse cash like",
  declaredKind: "a retail MCC",
  models: [
    { key: "gambling", subtype: "Gambling", short: "Gambling", priority: "P1", owner: "Cash-access / quasi-cash review",
      behavesLike: "a gambling cash-out / quasi-cash desk", signals: [QUASI, ROUND, TICKET, CNP] },
  ],
};

export const TYPOLOGY_CONFIGS: TypologyConfig[] = [
  MISCODING_CONFIG, MCC_ABUSE_CONFIG, SPLIT_CONFIG, FACTORING_CONFIG, SURCHARGE_CONFIG, CASH_CONFIG,
];
