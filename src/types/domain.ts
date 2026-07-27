// ---------------------------------------------------------------------------
// Core domain model for the Integrity Intelligence Command Center.
// All entities are SYNTHETIC. Ground-truth fields exist only because the data
// is generated; production systems would not have them.
// ---------------------------------------------------------------------------

export type Typology =
  | "MCC_MISCODING"
  | "MCC_ABUSE"
  | "SPLIT_TICKETING"
  | "FACTORING"
  | "FAKE_DESCRIPTOR"
  | "CASH_DISBURSEMENT"
  | "CLEAN";

export const TYPOLOGY_LABELS: Record<Typology, string> = {
  MCC_MISCODING: "MCC Miscoding",
  MCC_ABUSE: "MCC / Interchange Abuse",
  SPLIT_TICKETING: "Split Ticketing",
  FACTORING: "Factoring / Laundering",
  FAKE_DESCRIPTOR: "Fake Descriptor",
  CASH_DISBURSEMENT: "Cash-Disbursement Abuse",
  CLEAN: "No Abuse",
};

export type RiskTier = "critical" | "high" | "elevated" | "watch" | "clear";

export type EntryMode = "chip" | "swipe" | "contactless" | "ecom" | "manual" | "fallback";

export interface MerchantProfile {
  merchantId: string;
  legalName: string;
  tradeName: string;
  descriptor: string;
  alternateDescriptors: string[];
  declaredMcc: string;
  /** Synthetic ground truth — the business the merchant actually operates. */
  actualBusinessMcc: string;
  businessCategory: string;
  merchantType: "standard" | "submerchant" | "facilitator";
  paymentFacilitatorId: string | null;
  acquirerId: string;
  parentMerchantId: string | null;
  onboardingDate: string;
  country: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  websiteDomain: string;
  cardPresentRatio: number;
  cardNotPresentRatio: number;
  averageTicket: number;
  expectedTicketRange: [number, number];
  annualVolume: number;
  registeredAddressId: string;
  settlementBankAccountId: string;
  beneficialOwnerId: string;
  customerSupportPhone: string;
  deviceIds: string[];
  ipClusterIds: string[];
  /** Synthetic ground truth. */
  groundTruthTypology: Typology;
  groundTruthAbuseFlag: boolean;
}

export interface Transaction {
  transactionId: string;
  timestamp: number; // epoch ms
  merchantId: string;
  cardId: string;
  customerId: string;
  amount: number;
  currency: string;
  declaredMcc: string;
  merchantDescriptor: string;
  authorizationStatus: "approved" | "declined";
  entryMode: EntryMode;
  cardPresent: boolean;
  ecommerce: boolean;
  recurring: boolean;
  crossBorder: boolean;
  cardCountry: string;
  merchantCountry: string;
  deviceId: string;
  ipAddress: string;
  latitude: number;
  longitude: number;
  terminalId: string;
  authorizationCode: string;
  originalTransactionId: string | null;
  refund: boolean;
  reversal: boolean;
  dispute: boolean;
  disputeReason: string | null;
  cashEquivalent: boolean;
  walletLoad: boolean;
  productSignal: string;
  transactionClusterId: string | null;
  groundTruthTypology: Typology;
}

export interface CustomerProfile {
  customerId: string;
  cardIds: string[];
  accountAgeDays: number;
  homeGeography: string;
  normalSpendCategories: string[];
  typicalTicket: number;
  transactionFrequency: number;
  householdId: string;
  businessCard: boolean;
  riskSegment: "prime" | "near-prime" | "thin-file" | "high-risk";
}

// --- MCC taxonomy -----------------------------------------------------------

export interface MccDefinition {
  code: string;
  category: string;
  parentCategory: string;
  riskTier: "low" | "medium" | "high" | "prohibited-adjacent";
  typicalTicketRange: [number, number];
  typicalCardPresentRatio: number;
  typicalNightRatio: number;
  typicalDisputeRate: number;
  typicalRefundRate: number;
  expectedKeywords: string[];
}

// --- Feature + scoring outputs ---------------------------------------------

export interface FeatureContribution {
  id: string; // e.g. "F-017"
  label: string;
  value: number;
  /** Human-readable formatted value, e.g. "96%". */
  display: string;
  /** Signed contribution to risk (SHAP-style), normalized roughly to [-30, 30]. */
  contribution: number;
  /** Peer baseline for context. */
  peerBaseline?: number;
  direction: "raises" | "lowers" | "neutral";
}

export interface RuleHit {
  ruleId: string;
  name: string;
  typology: Typology;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  explanation: string;
}

export interface MccPrediction {
  declaredMcc: string;
  declaredLabel: string;
  predictedMcc: string;
  predictedLabel: string;
  confidence: number; // 0..1
  candidates: { mcc: string; label: string; probability: number }[];
  mismatchSeverity: RiskTier;
  hierarchyMatch: boolean;
}

export interface RiskScoreBreakdown {
  ruleScore: number;
  supervisedScore: number;
  anomalyScore: number;
  graphScore: number;
  descriptorNlpScore: number;
  mccMismatchScore: number;
  behavioralChangeScore: number;
  finalRiskScore: number;
  tier: RiskTier;
}

export interface MerchantFeatures {
  merchantId: string;
  // volume / ticket
  txnCount: number;
  totalVolume: number;
  avgTicket: number;
  medianTicket: number;
  stdTicket: number;
  p95Ticket: number;
  roundDollarRatio: number;
  ticketBimodality: number;
  // channel
  cardNotPresentRatio: number;
  crossBorderRatio: number;
  fallbackRatio: number;
  manualEntryRatio: number;
  // timing
  nightRatio: number;
  weekendRatio: number;
  velocityPerActiveHour: number;
  // outcomes
  refundRate: number;
  reversalRate: number;
  disputeRate: number;
  notRecognizedDisputeRate: number;
  refundAfterPurchaseRatio: number;
  // cards / customers
  uniqueCardRatio: number;
  repeatCardRatio: number;
  rapidRepeatRatio: number;
  // descriptor
  descriptorCount: number;
  descriptorEntropy: number;
  descriptorNameSimilarity: number;
  brandMimicScore: number;
  genericTokenRatio: number;
  // cash-equivalent
  cashEquivalentRatio: number;
  walletLoadRatio: number;
  thresholdProximityRatio: number;
  // graph / infra
  sharedDeviceCount: number;
  sharedIpCount: number;
  sharedBankAccountCount: number;
  submerchantCount: number;
  categoryDiversity: number;
  geoDispersion: number;
  // divergence
  mccDivergence: number;
  changePointScore: number;
  // peer context
  peerNightZ: number;
  peerCnpZ: number;
  peerTicketZ: number;
}

// --- Behavioral archetypes --------------------------------------------------
// The reframe: we do NOT predict "which MCC is correct". We measure how closely
// a merchant's OBSERVED behavior resembles the behavioral signature of a known
// high-risk operator type (adult, gambling, unlicensed pharma, crypto/quasi-cash).
// A high similarity on a benign-declared merchant is the miscoding signal.

/** One observed feature explaining WHY a merchant looks like an archetype. */
export interface ArchetypeAttribution {
  id: string; // feature id (shared with FeatureContribution, e.g. "F-002")
  label: string;
  observed: string; // formatted observed value ("98%")
  expected: string; // archetype's expected value ("≥ 90%")
  match: number; // 0..1 how well this axis matches the archetype
  share: number; // 0..1 fraction of the similarity this axis explains
}

/** How strongly a merchant behaves like one archetype. */
export interface ArchetypeMatch {
  key: string; // "adult" | "gambling" | "pharma" | "crypto" | ...
  label: string; // "Adult & dating operator"
  short: string; // "Adult"
  similarity: number; // 0..100 behavioral resemblance
  anchorMcc: string; // canonical MCC of this operator type
  anchorLabel: string;
  riskTier: "low" | "medium" | "high" | "prohibited-adjacent"; // from the anchor MCC
  rationale: string; // one-line plain-English why
  attributions: ArchetypeAttribution[]; // significant variables, ranked
}

export interface MerchantRiskRecord {
  merchant: MerchantProfile;
  features: MerchantFeatures;
  scores: RiskScoreBreakdown;
  mcc: MccPrediction;
  ruleHits: RuleHit[];
  topFeatures: FeatureContribution[];
  primaryTypology: Typology;
  typologyScores: Record<Exclude<Typology, "CLEAN">, number>;
  /** Ranked behavioral resemblance to known high-risk operator types. */
  archetypeMatches: ArchetypeMatch[];
}

// --- Cases ------------------------------------------------------------------

export type CaseStatus =
  | "new"
  | "triage"
  | "investigating"
  | "escalated"
  | "resolved"
  | "closed";

export type Disposition =
  | "pending"
  | "false-positive"
  | "confirmed-abuse"
  | "monitor"
  | "insufficient-evidence";

export type RecommendedAction =
  | "no-action"
  | "continue-monitoring"
  | "request-info"
  | "enhanced-due-diligence"
  | "correct-mcc"
  | "restrict-processing"
  | "heightened-monitoring"
  | "review-facilitator"
  | "escalate-network-integrity"
  | "merchant-outreach"
  | "suspend-txn-types"
  | "terminate-relationship"
  | "legal-compliance-review";

export interface CaseNote {
  id: string;
  author: string;
  timestamp: number;
  text: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
}

export interface InvestigationCase {
  caseId: string;
  alertId: string;
  merchantId: string;
  createdAt: number;
  severity: RiskTier;
  queue: string;
  assignedAnalyst: string;
  status: CaseStatus;
  slaDueAt: number;
  typology: Typology;
  modelScore: number;
  disposition: Disposition;
  recommendedAction: RecommendedAction;
  hypothesis: string;
  notes: CaseNote[];
  audit: AuditEntry[];
  recoveredAmount: number;
  preventedExposure: number;
  resolutionDate: number | null;
}

// A case a user files from a completed AI investigation. Unlike InvestigationCase
// (generated by the engine), these are authored by the analyst mid-session and
// persist locally — the write-back that links the investigation desk to the
// executive Command Center. Synthesis fields are the investigation's own free
// text, not the generated-case enums.
export interface FiledCase {
  id: string;
  filedAt: number; // epoch ms
  merchantId: string;
  merchantName: string;
  familyLabel: string; // short family name, e.g. "MCC Abuse"
  familyColor: string; // hex, for the exec-view dot
  suspectedLabel: string; // what it behaves like
  score: number; // 0..100 integrity/composite risk
  disposition: string; // investigation synthesis disposition
  recommended: string; // investigation synthesis recommended action
  confidence: number; // 0..1
  href: string; // route to reopen the investigation
  plane: "A" | "B";
}

// --- Graph ------------------------------------------------------------------

export type GraphNodeType =
  | "merchant"
  | "facilitator"
  | "acquirer"
  | "bank"
  | "owner"
  | "address"
  | "device"
  | "ip"
  | "domain"
  | "descriptor";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  risk: number; // 0..100
  known_bad?: boolean;
  meta?: Record<string, string | number>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface EntityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Scenarios --------------------------------------------------------------

export interface DemoScenario {
  scenarioId: string;
  merchantId: string;
  title: string;
  primaryTypology: Typology;
  story: string;
  expectedSignals: string[];
}
