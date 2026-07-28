import { Suspense, lazy, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Layout } from "@/app/Layout";
import { LoadingScreen } from "@/app/LoadingScreen";
import { ErrorBoundary } from "@/app/ErrorBoundary";

const Executive = lazy(() => import("@/pages/ExecutiveCommandCenter"));
const Explorer = lazy(() => import("@/pages/DataExplorer"));
const MccStudio = lazy(() => import("@/pages/MccStudio"));
const MccAbuse = lazy(() => import("@/pages/MccAbuse"));
const SplitLab = lazy(() => import("@/pages/SplitTicketingLab"));
const Surcharge = lazy(() => import("@/pages/SurchargeConsole"));
const Cash = lazy(() => import("@/pages/CashDisbursement"));
const Investigation = lazy(() => import("@/pages/Investigation"));
const ModelStore = lazy(() => import("@/pages/ModelStore"));
const Anatomy = lazy(() => import("@/pages/AnatomyDeck"));
const RulesPage = lazy(() => import("@/pages/RulesEngine"));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center py-24 text-sm text-ink-3">
      Loading module…
    </div>
  );
}

export function App() {
  const status = useAppStore((s) => s.status);
  const load = useAppStore((s) => s.load);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  if (status !== "ready") return <LoadingScreen />;

  return (
    <HashRouter>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Executive />} />
              {/* Merchant Universe folded into Data Explorer's Risk-table view. */}
              <Route path="/universe" element={<Navigate to="/explorer" replace />} />
              <Route path="/explorer" element={<Explorer />} />
              {/* Typology Hub retired — anatomies live on the Anatomy tab. */}
              <Route path="/typologies" element={<Navigate to="/anatomy" replace />} />
              <Route path="/mcc" element={<MccStudio />} />
              <Route path="/mcc/:category" element={<MccStudio />} />
              <Route path="/mcc-abuse" element={<MccAbuse />} />
              <Route path="/mcc-abuse/:category" element={<MccAbuse />} />
              <Route path="/split" element={<SplitLab />} />
              <Route path="/split/:category" element={<SplitLab />} />
              {/* Factoring retired as its own tab — its cohort is covered under MCC Miscoding. */}
              <Route path="/factoring" element={<Navigate to="/mcc" replace />} />
              <Route path="/factoring/:category" element={<Navigate to="/mcc" replace />} />
              <Route path="/surcharge" element={<Surcharge />} />
              <Route path="/surcharge/:category" element={<Surcharge />} />
              {/* legacy path → surcharge (renamed from Descriptor Intelligence) */}
              <Route path="/descriptors" element={<Navigate to="/surcharge" replace />} />
              <Route path="/descriptors/:category" element={<Navigate to="/surcharge" replace />} />
              <Route path="/cash" element={<Cash />} />
              <Route path="/cash/:category" element={<Cash />} />
              <Route path="/investigate" element={<Investigation />} />
              <Route path="/investigate/:merchantId" element={<Investigation />} />
              <Route path="/anatomy" element={<Anatomy />} />
              <Route path="/models" element={<ModelStore />} />
              <Route path="/rules" element={<RulesPage />} />
              {/* Retired tabs — fall through to the Command Center. */}
              <Route path="/cases" element={<Navigate to="/" replace />} />
              <Route path="/observatory" element={<Navigate to="/" replace />} />
              <Route path="/simulator" element={<Navigate to="/" replace />} />
              <Route path="/architecture" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Executive />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </HashRouter>
  );
}
