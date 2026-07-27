import type { Typology } from "@/types/domain";

// ---------------------------------------------------------------------------
// "Anatomy of the abuse" reference content for the Typology Hub.
//
// This is the intelligence layer that sits ON TOP of the detection engine: for
// each typology it makes explicit (1) what the abuse actually is, (2) the
// concrete sub-variants an analyst must distinguish (e.g. for MCC miscoding:
// gambling vs. adult vs. rogue pharma vs. crypto), (3) how the platform
// *identifies* it from transaction signals, (4) the validation ladder used to
// *corroborate* a signal into a defensible finding (behavioral → OSINT → graph
// → human confirmation), and (5) why it matters (regulatory / financial / brand
// implications). All content is educational reference material — decision
// support, not legal or compliance determination.
// ---------------------------------------------------------------------------

export type ValidationTier = "signal" | "corroboration" | "confirmation";

export interface ValidationMethod {
  tier: ValidationTier;
  method: string;
  detail: string;
  /** Whether this rung is computed in-platform today vs. an external/manual step. */
  inPlatform: boolean;
}

export interface TypologyVariant {
  name: string;
  /** e.g. declared "5999 Misc Retail" masking actual "7995 Gambling". */
  declaredExample?: string;
  actualExample?: string;
  tell: string;
}

export interface AnatomyModule {
  typ: Exclude<Typology, "CLEAN">;
  alias: string;
  oneLiner: string;
  definition: string;
  /** The distinct forms the analyst must tell apart. */
  variants: TypologyVariant[];
  /** Observable transaction signals the engine keys on. */
  identificationSignals: { label: string; feature: string }[];
  /** The corroboration ladder from raw signal to defensible finding. */
  validationLadder: ValidationMethod[];
  implications: { area: string; text: string }[];
  /** Networks / regulatory hooks worth naming in the room. */
  regulatoryHooks: string[];
}

// Shared validation methods reused across typologies keep the ladder consistent.
const OSINT_WEB: ValidationMethod = {
  tier: "corroboration",
  method: "OSINT — live web & domain",
  detail:
    "Fetch the merchant's website / checkout, scan page content for vertical keywords, compare the live offering against the declared MCC. Check domain age (WHOIS), hosting, and app-store / social listings for the true line of business.",
  inPlatform: false,
};
const OSINT_REGISTRY: ValidationMethod = {
  tier: "corroboration",
  method: "OSINT — corporate & beneficial ownership",
  detail:
    "Cross-reference the registered legal entity and beneficial owner against corporate registries, sanctions / PEP lists, and adverse-media search to expose front companies and shared principals.",
  inPlatform: false,
};
const WATCHLIST: ValidationMethod = {
  tier: "corroboration",
  method: "Watchlist & consortium data",
  detail:
    "Check the merchant, principal, domain, and settlement account against network termination files (Mastercard MATCH / Visa VMSS), internal known-bad, and consortium fraud lists.",
  inPlatform: false,
};
const HUMAN: ValidationMethod = {
  tier: "confirmation",
  method: "Analyst evidence pack & disposition",
  detail:
    "An investigator assembles the signal + corroboration into an evidence pack, optionally runs a test transaction / mystery-shop, and records an accountable disposition with SLA and audit trail.",
  inPlatform: true,
};

export const ANATOMY: AnatomyModule[] = [
  {
    typ: "MCC_MISCODING",
    alias: "Category Laundering",
    oneLiner: "A merchant transacts as a high-risk business while boarded under a benign category.",
    definition:
      "The merchant is declared / boarded under a low-risk MCC (e.g. 5999 Misc Retail, 5411 Grocery, 8999 Professional Services) but its actual transaction behavior belongs to a higher-risk or prohibited vertical. Miscoding hides the true nature of the business from the acquirer and card networks, defeats risk-based pricing and monitoring, and can conceal an outright illegal operation.",
    variants: [
      {
        name: "Gambling / betting",
        declaredExample: "5999 Misc Retail",
        actualExample: "7995 Betting / Casino",
        tell: "Near-100% card-not-present, very high overnight ratio, round-dollar wallet loads, 'bet / stake / wager' descriptors, elevated disputes.",
      },
      {
        name: "Adult / dating & escort",
        declaredExample: "7399 Business Services",
        actualExample: "7273 Dating & Escort",
        tell: "~100% CNP, the highest night ratio of any vertical, recurring membership billing, high 'not recognized' dispute share.",
      },
      {
        name: "Rogue pharma / nutraceutical",
        declaredExample: "5912 Drug Store",
        actualExample: "5967 Direct Marketing / online supplement",
        tell: "Free-trial → negative-option recurring billing, high refund + dispute rate, cross-border card BINs.",
      },
      {
        name: "Crypto / quasi-cash / wallet load",
        declaredExample: "5734 Software",
        actualExample: "6051 Quasi-Cash / Crypto",
        tell: "Cash-equivalent flags, large round-dollar tickets, wallet-load signal, 'topup / reload / exchange' keywords.",
      },
      {
        name: "Other restricted (CBD, firearms, tobacco, pseudo-Rx)",
        tell: "Extensible: the same fingerprint-divergence method generalizes to any vertical with a distinct behavioral profile.",
      },
    ],
    identificationSignals: [
      { label: "Declared-MCC behavioral divergence", feature: "mccDivergence" },
      { label: "Card-not-present ratio vs. category norm", feature: "cardNotPresentRatio" },
      { label: "Overnight transaction ratio", feature: "nightRatio" },
      { label: "Cash-equivalent share", feature: "cashEquivalentRatio" },
      { label: "Product-signal keywords (bet / wallet-load)", feature: "productSignal" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Behavioral fingerprint classifier",
        detail:
          "Nearest-behavioral-profile model scores observed CNP, night, ticket, dispute and keyword signals against every candidate MCC's expected profile, predicts the true category, and flags when the predicted parent category diverges from what was declared — escalated by severity (low → prohibited-adjacent = critical).",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Product-signal & descriptor forensics",
        detail:
          "Corroborate the classifier with observed descriptor tokens and product-signal keywords carried on the transaction stream (e.g. gaming or wallet-load terms).",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Peer-cohort benchmarking",
        detail:
          "Z-score the merchant against the cohort of merchants that share its declared MCC to quantify how many standard deviations its behavior sits from the honest peer norm.",
        inPlatform: true,
      },
      OSINT_WEB,
      WATCHLIST,
      HUMAN,
    ],
    implications: [
      { area: "Regulatory", text: "Unlicensed money transmission, illegal gambling, BSA/AML exposure; unknown true line of business defeats KYC." },
      { area: "Financial", text: "Network non-compliance fines, mispriced risk, chargeback and fine liability lands on the acquirer." },
      { area: "Brand", text: "Reputational harm from facilitating prohibited verticals; potential forced deboarding and MATCH listing." },
    ],
    regulatoryHooks: ["Visa GBPP", "Mastercard BRAM/BAM", "BSA / AML", "MATCH (TMF)"],
  },
  {
    typ: "MCC_ABUSE",
    alias: "Interchange Manipulation / Rate Downgrade",
    oneLiner: "The line of business is honest, but transactions are qualified into a cheaper interchange band than they warrant.",
    definition:
      "Distinct from miscoding: the merchant's declared category matches what it actually sells, so the content model that catches miscoding is blind here. The abuse is in the *interchange qualification* — keyed/fallback entry, cross-border settlement, or missing data submitted under a low-rate card-present retail band the transactions don't qualify for. It leaks interchange revenue and misrepresents settlement risk to the network.",
    variants: [
      {
        name: "Keyed / fallback downgrade",
        declaredExample: "5411 Grocery (qualified CP)",
        actualExample: "Keyed / fallback settlement",
        tell: "A high share of manual-key or fallback entry under a band that assumes chip/contactless card-present acceptance.",
      },
      {
        name: "Cross-border qualification gap",
        tell: "Material cross-border settlement volume routed as domestic-qualified, inconsistent with the declared interchange band.",
      },
      {
        name: "Large-ticket band mismatch",
        tell: "Average tickets well above the declared retail band's norm while claiming its qualified rate.",
      },
    ],
    identificationSignals: [
      { label: "Keyed / fallback entry ratio", feature: "manualEntryRatio" },
      { label: "Fallback entry ratio", feature: "fallbackRatio" },
      { label: "Cross-border settlement ratio", feature: "crossBorderRatio" },
      { label: "Content divergence (LOW — separates from miscoding)", feature: "mccDivergence" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Interchange-qualification re-derivation",
        detail:
          "Re-score each settlement against the interchange tier its entry mode, geography and data completeness actually qualify for, and quantify the gap against the declared band — while confirming content-divergence is low (i.e. not miscoding).",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Settlement & pricing reconciliation",
        detail:
          "Reconcile the merchant's interchange qualification history and pricing tier with the acquirer's board record to confirm systematic downgrade rather than incidental keyed volume.",
        inPlatform: false,
      },
      HUMAN,
    ],
    implications: [
      { area: "Financial", text: "Direct interchange-revenue leakage and mispriced settlement risk for the acquirer and network." },
      { area: "Regulatory", text: "Network interchange-integrity and pricing-integrity rules; potential assessments on re-qualification." },
      { area: "Operational", text: "Rule-routed, not model-routed — the content composite is blind, so a dedicated interchange signal is required." },
    ],
    regulatoryHooks: ["Visa/MC interchange qualification rules", "Pricing integrity", "Settlement compliance"],
  },
  {
    typ: "SPLIT_TICKETING",
    alias: "Structuring / Threshold Avoidance",
    oneLiner: "One purchase is broken into several smaller charges to slip under a control threshold.",
    definition:
      "A single sale is deliberately divided into multiple lower-value transactions so each stays beneath a monitoring, authorization, floor-limit, or reporting threshold. It evades velocity controls and step-up authentication and is a classic structuring pattern.",
    variants: [
      { name: "Near-threshold clustering", tell: "Bursts of charges just below the monitoring threshold (e.g. 90–100% of $500), close together in time." },
      { name: "Rapid same-card repeats", tell: "The same card charged multiple times at the merchant within minutes." },
      { name: "Multi-terminal / multi-MID splitting", tell: "The sale is spread across several terminals or MIDs to dilute per-node velocity." },
      { name: "Even-division splitting", tell: "A large basket divided into equal parts that reconstruct to a single round total." },
    ],
    identificationSignals: [
      { label: "Near-threshold ticket ratio", feature: "thresholdProximityRatio" },
      { label: "Rapid-repeat (same card < 5 min)", feature: "rapidRepeatRatio" },
      { label: "Transaction cluster bursts", feature: "transactionClusterId" },
      { label: "Ticket bimodality", feature: "ticketBimodality" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Cluster & threshold-proximity detection",
        detail:
          "Detect bursts of 4–6 near-threshold charges on the same card/device within a tight time window and measure the share of tickets sitting in the 90–100% threshold band.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Cluster reconstruction",
        detail:
          "Reassemble split clusters via shared cluster id, card, device and timing to show the true aggregate sale that was hidden.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Basket / catalog cross-check (OSINT)",
        detail:
          "Compare reconstructed totals against the merchant's published price list / catalog to show the split maps to a single real item priced above the threshold.",
        inPlatform: false,
      },
      HUMAN,
    ],
    implications: [
      { area: "Regulatory", text: "AML structuring; deliberate evasion of monitoring and reporting controls." },
      { area: "Financial", text: "Defeats fraud controls and step-up auth; often a precursor to bust-out losses." },
      { area: "Operational", text: "Erodes the integrity of every downstream threshold-based control." },
    ],
    regulatoryHooks: ["BSA structuring", "Network monitoring rules"],
  },
  {
    typ: "FACTORING",
    alias: "Transaction Laundering / Aggregation",
    oneLiner: "An approved merchant pushes another undisclosed business's sales through its own MID.",
    definition:
      "A legitimate, boarded merchant processes card transactions on behalf of a different, undisclosed business — frequently a prohibited one. The true merchant of record is hidden, so the acquirer underwrites and is liable for a business it never approved. Also called transaction laundering or BIN caging.",
    variants: [
      { name: "Undisclosed submerchants (PayFac abuse)", tell: "A facilitator boards many submerchants; some are unvetted or prohibited." },
      { name: "Shared settlement-account ring", tell: "Multiple 'independent' MIDs settle to one bank account or beneficial owner." },
      { name: "Front-company network", tell: "Cluster of shell merchants sharing devices, IPs, addresses and principals." },
      { name: "Known-bad adjacency", tell: "Short graph path from the merchant to a previously terminated entity." },
    ],
    identificationSignals: [
      { label: "Shared settlement accounts", feature: "sharedBankAccountCount" },
      { label: "Shared devices / IPs", feature: "sharedDeviceCount / sharedIpCount" },
      { label: "Undisclosed submerchant count", feature: "submerchantCount" },
      { label: "Product-category diversity", feature: "categoryDiversity" },
      { label: "Path to known-bad node", feature: "graphScore" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Entity-graph adjacency & shortest-path",
        detail:
          "Build the merchant graph over shared banks, devices, IPs, owners and addresses; score proximity to known-bad nodes and detect dense rings that shouldn't exist between 'independent' merchants.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Settlement & KYC correlation",
        detail:
          "Correlate settlement accounts, beneficial owners and device fingerprints across the cluster to confirm common control.",
        inPlatform: true,
      },
      OSINT_REGISTRY,
      {
        tier: "corroboration",
        method: "Checkout-path inspection (OSINT)",
        detail:
          "Inspect the merchant's live checkout to see whether a different, undisclosed entity's payment actually routes through this MID.",
        inPlatform: false,
      },
      HUMAN,
    ],
    implications: [
      { area: "Regulatory", text: "Prohibited under network rules; unknown merchant of record breaks KYC/AML; may fund illicit goods." },
      { area: "Financial", text: "Acquirer carries liability and chargeback exposure for a business it never underwrote." },
      { area: "Brand", text: "Direct facilitation of laundering carries severe reputational and enforcement risk." },
    ],
    regulatoryHooks: ["Visa/MC transaction-laundering rules", "AML", "KYC / merchant of record"],
  },
  {
    typ: "FAKE_DESCRIPTOR",
    alias: "Descriptor Deception / Brand Mimicry",
    oneLiner: "The billing descriptor is engineered to be unrecognizable, generic, or to impersonate a brand.",
    definition:
      "The statement descriptor is deceptive — mimicking a well-known brand, deliberately generic/obfuscated, or unrelated to the legal or trade name — to suppress cardholder recognition (lowering chargebacks) or to phish. It directly harms cardholders and inflates 'I don't recognize this' disputes.",
    variants: [
      { name: "Brand mimicry", tell: "Descriptor is n-gram-similar to a major brand (e.g. resembles AMAZON / WALMART) to borrow legitimacy." },
      { name: "Generic-token obfuscation", tell: "Filler tokens like 'GROUP LLC SVCS GLOBAL' that convey nothing about the purchase." },
      { name: "Descriptor rotation", tell: "Many distinct descriptors on one MID (high entropy) to dodge recognition and pattern-matching." },
      { name: "Legal-name mismatch", tell: "Descriptor bears little similarity to the registered legal / trade name." },
    ],
    identificationSignals: [
      { label: "Brand-mimic n-gram similarity", feature: "brandMimicScore" },
      { label: "Descriptor entropy (rotation)", feature: "descriptorEntropy" },
      { label: "Generic-token ratio", feature: "genericTokenRatio" },
      { label: "Descriptor ↔ legal-name similarity", feature: "descriptorNameSimilarity" },
      { label: "'Not recognized' dispute rate", feature: "notRecognizedDisputeRate" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Descriptor NLP scoring",
        detail:
          "Score brand-mimic similarity, descriptor entropy, generic-token ratio and legal-name mismatch, weighted by the observed 'merchant not recognized' dispute rate.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Dispute-narrative mining",
        detail:
          "Confirm cardholder confusion by mining chargeback reason codes and free-text 'not recognized' narratives tied to the descriptor.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Brand & trademark verification (OSINT)",
        detail:
          "Verify whether the mimicked brand is a real, unaffiliated trademark holder and whether the descriptor infringes or impersonates it.",
        inPlatform: false,
      },
      HUMAN,
    ],
    implications: [
      { area: "Consumer", text: "Cardholders can't recognize charges → friendly-fraud disputes, real fraud concealment, direct harm." },
      { area: "Regulatory", text: "Deceptive-practices exposure (e.g. FTC); trademark infringement where brands are mimicked." },
      { area: "Operational", text: "Descriptor rotation defeats naive rule-based monitoring." },
    ],
    regulatoryHooks: ["FTC deceptive practices", "Network descriptor rules", "Trademark"],
  },
  {
    typ: "CASH_DISBURSEMENT",
    alias: "Quasi-Cash / Cash Conversion",
    oneLiner: "Card sales are converted into cash or cash-equivalent value the MID isn't permitted to give.",
    definition:
      "Purchases that are really disguised cash advances — phantom 'sales' converted to cash, prepaid/wallet loads, or round-dollar charges paired with refunds — on a MID not authorized for quasi-cash. It is a money-laundering and bust-out vector.",
    variants: [
      { name: "Round-dollar phantom sales", tell: "Clean round-dollar 'purchases' with no corresponding goods, at cash-like tickets." },
      { name: "Wallet / prepaid load", tell: "Card used to load prepaid or wallet balances (cash-equivalent) outside the permitted MCC." },
      { name: "Refund-after-purchase laundering", tell: "A purchase quickly paired with a partial/full refund to move value while masking it as retail." },
      { name: "Crypto off-ramp", tell: "Cash-equivalent conversion to crypto, often with a behavioral change-point when the pattern begins." },
    ],
    identificationSignals: [
      { label: "Cash-equivalent flag ratio", feature: "cashEquivalentRatio" },
      { label: "Round-dollar ratio", feature: "roundDollarRatio" },
      { label: "Wallet-load ratio", feature: "walletLoadRatio" },
      { label: "Refund-after-purchase pairing", feature: "refundAfterPurchaseRatio" },
      { label: "Behavioral change-point", feature: "changePointScore" },
    ],
    validationLadder: [
      {
        tier: "signal",
        method: "Cash-pattern scoring",
        detail:
          "Score the blend of cash-equivalent flags, round-dollar concentration, wallet-load share and refund-after-purchase pairing that distinguishes cash conversion from genuine retail.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Purchase–refund reconstruction",
        detail:
          "Reassemble paired purchase/refund events on the same card to expose value movement disguised as normal sales activity.",
        inPlatform: true,
      },
      {
        tier: "corroboration",
        method: "Prepaid / wallet BIN detection",
        detail:
          "Corroborate wallet-load behavior against prepaid BIN ranges and settlement patterns; benchmark round-dollar concentration against peers.",
        inPlatform: false,
      },
      HUMAN,
    ],
    implications: [
      { area: "Regulatory", text: "Quasi-cash is prohibited on most MCCs; strong AML / money-laundering exposure." },
      { area: "Financial", text: "Frequent precursor to merchant bust-out and unrecoverable losses." },
      { area: "Brand", text: "Facilitating cash conversion / off-ramping draws enforcement scrutiny." },
    ],
    regulatoryHooks: ["Quasi-cash rules", "AML / SAR", "Bust-out risk"],
  },
];

export const ANATOMY_BY_TYPOLOGY: Record<string, AnatomyModule> = Object.fromEntries(
  ANATOMY.map((a) => [a.typ, a]),
);

export const VALIDATION_TIER_LABEL: Record<ValidationTier, string> = {
  signal: "Signal",
  corroboration: "Corroboration",
  confirmation: "Confirmation",
};
