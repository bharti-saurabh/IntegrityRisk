import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  MerchantRiskRecord,
  InvestigationCase,
  Transaction,
  CaseNote,
  CaseStatus,
  Disposition,
  RecommendedAction,
  AuditEntry,
} from "@/types/domain";
import type { EngineResult } from "@/workers/protocol";
import { DEFAULT_GEN_CONFIG, type GenConfig } from "@/data/generator";
import { DEFAULT_RULES, type Rule } from "@/analytics/rules/rules";
import { reconfigureEngine } from "@/services/engineClient";
import { computeModelMetrics } from "@/analytics/modelMetrics";

export type Persona = "executive" | "analyst" | "data-scientist" | "operations";

export interface CasePatch {
  status?: CaseStatus;
  disposition?: Disposition;
  recommendedAction?: RecommendedAction;
  notes?: CaseNote[];
  audit?: AuditEntry[];
  assignedAnalyst?: string;
}

interface PersistedState {
  persona: Persona;
  threshold: number;
  casePatches: Record<string, CasePatch>;
  ruleOverrides: Record<string, { enabled: boolean }>;
  demoStep: number;
  seed: string;
}

interface AppState extends PersistedState {
  status: "idle" | "loading" | "ready" | "error";
  progress: { phase: string; pct: number };
  error: string | null;
  result: EngineResult | null;
  recordIndex: Map<string, MerchantRiskRecord>;
  rules: Rule[];
  config: GenConfig;
  selectedMerchantId: string | null;

  // actions
  load: () => Promise<void>;
  recompute: () => Promise<void>;
  selectMerchant: (id: string | null) => void;
  setPersona: (p: Persona) => void;
  setThreshold: (t: number) => void;
  toggleRule: (id: string) => void;
  resetRules: () => void;
  getRecord: (id: string) => MerchantRiskRecord | undefined;
  getTransactions: (id: string) => Transaction[];
  getCases: () => InvestigationCase[];
  getCase: (caseId: string) => InvestigationCase | undefined;
  patchCase: (caseId: string, patch: CasePatch, action: string, actor?: string) => void;
  addNote: (caseId: string, text: string, author?: string) => void;
  setDemoStep: (n: number) => void;
  resetDemo: () => void;
}

function mergeCase(base: InvestigationCase, patch?: CasePatch): InvestigationCase {
  if (!patch) return base;
  return {
    ...base,
    status: patch.status ?? base.status,
    disposition: patch.disposition ?? base.disposition,
    recommendedAction: patch.recommendedAction ?? base.recommendedAction,
    assignedAnalyst: patch.assignedAnalyst ?? base.assignedAnalyst,
    notes: patch.notes ? [...base.notes, ...patch.notes] : base.notes,
    audit: patch.audit ? [...base.audit, ...patch.audit] : base.audit,
  };
}

function applyRuleOverrides(rules: Rule[], overrides: Record<string, { enabled: boolean }>): Rule[] {
  return rules.map((r) => (overrides[r.id] ? { ...r, enabled: overrides[r.id].enabled } : r));
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      persona: "executive",
      threshold: 62,
      casePatches: {},
      ruleOverrides: {},
      demoStep: 0,
      seed: String(DEFAULT_GEN_CONFIG.seed),

      status: "idle",
      progress: { phase: "", pct: 0 },
      error: null,
      result: null,
      recordIndex: new Map(),
      rules: DEFAULT_RULES,
      config: DEFAULT_GEN_CONFIG,
      selectedMerchantId: null,

      load: async () => {
        if (get().status === "loading") return;
        set({ status: "loading", error: null, progress: { phase: "Starting engine", pct: 2 } });
        try {
          const config = { ...DEFAULT_GEN_CONFIG, seed: get().seed };
          const rules = applyRuleOverrides(DEFAULT_RULES, get().ruleOverrides);
          const result = await reconfigureEngine(config, rules, (phase, pct) =>
            set({ progress: { phase, pct } }),
          );
          const recordIndex = new Map(result.records.map((r) => [r.merchant.merchantId, r]));
          set({ status: "ready", result, recordIndex, rules, config, progress: { phase: "Ready", pct: 100 } });
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      },

      recompute: async () => {
        const { config, rules } = get();
        set({ status: "loading", progress: { phase: "Recomputing", pct: 5 } });
        try {
          const result = await reconfigureEngine(config, rules, (phase, pct) =>
            set({ progress: { phase, pct } }),
          );
          const recordIndex = new Map(result.records.map((r) => [r.merchant.merchantId, r]));
          set({ status: "ready", result, recordIndex, progress: { phase: "Ready", pct: 100 } });
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      },

      selectMerchant: (id) => set({ selectedMerchantId: id }),
      setPersona: (p) => set({ persona: p }),
      setThreshold: (t) => set({ threshold: t }),

      toggleRule: (id) => {
        const rules = get().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
        const ruleOverrides = { ...get().ruleOverrides };
        const target = rules.find((r) => r.id === id)!;
        ruleOverrides[id] = { enabled: target.enabled };
        set({ rules, ruleOverrides });
        void get().recompute();
      },

      resetRules: () => {
        set({ rules: DEFAULT_RULES.map((r) => ({ ...r })), ruleOverrides: {} });
        void get().recompute();
      },

      getRecord: (id) => get().recordIndex.get(id),
      getTransactions: (id) => get().result?.txnSamples[id] ?? [],

      getCases: () => {
        const { result, casePatches } = get();
        if (!result) return [];
        return result.cases.map((c) => mergeCase(c, casePatches[c.caseId]));
      },
      getCase: (caseId) => get().getCases().find((c) => c.caseId === caseId),

      patchCase: (caseId, patch, action, actor = "You") => {
        const now = Date.now();
        const existing = get().casePatches[caseId] ?? {};
        const audit: AuditEntry[] = [
          ...(patch.audit ?? []),
          { id: `au-${now}`, timestamp: now, actor, action },
        ];
        const merged: CasePatch = {
          ...existing,
          ...patch,
          notes: [...(existing.notes ?? []), ...(patch.notes ?? [])],
          audit: [...(existing.audit ?? []), ...audit],
        };
        set({ casePatches: { ...get().casePatches, [caseId]: merged } });
      },

      addNote: (caseId, text, author = "You") => {
        const now = Date.now();
        const note: CaseNote = { id: `n-${now}`, author, timestamp: now, text };
        get().patchCase(caseId, { notes: [note] }, `Note added`, author);
      },

      setDemoStep: (n) => set({ demoStep: n }),
      resetDemo: () => set({ demoStep: 0 }),
    }),
    {
      name: "iicc-store-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedState => ({
        persona: s.persona,
        threshold: s.threshold,
        casePatches: s.casePatches,
        ruleOverrides: s.ruleOverrides,
        demoStep: s.demoStep,
        seed: s.seed,
      }),
    },
  ),
);

// Threshold-dependent metrics recomputed on the main thread (pure over records).
export function metricsAtThreshold(result: EngineResult | null, threshold: number) {
  if (!result) return null;
  return computeModelMetrics(result.records, threshold);
}
