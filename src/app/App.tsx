import { Suspense, lazy, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Layout } from "@/app/Layout";
import { LoadingScreen } from "@/app/LoadingScreen";
import { ErrorBoundary } from "@/app/ErrorBoundary";

const Executive = lazy(() => import("@/pages/ExecutiveCommandCenter"));
const Explorer = lazy(() => import("@/pages/DataExplorer"));
const Typologies = lazy(() => import("@/pages/TypologyHub"));
const MccStudio = lazy(() => import("@/pages/MccStudio"));
const MccAbuse = lazy(() => import("@/pages/MccAbuse"));
const SplitLab = lazy(() => import("@/pages/SplitTicketingLab"));
const Factoring = lazy(() => import("@/pages/FactoringExplorer"));
const Descriptors = lazy(() => import("@/pages/DescriptorIntelligence"));
const Cash = lazy(() => import("@/pages/CashDisbursement"));
const Investigation = lazy(() => import("@/pages/Investigation"));
const Cases = lazy(() => import("@/pages/CaseQueue"));
const Observatory = lazy(() => import("@/pages/ModelObservatory"));
const ModelStore = lazy(() => import("@/pages/ModelStore"));
const Anatomy = lazy(() => import("@/pages/AnatomyDeck"));
const Simulator = lazy(() => import("@/pages/ImpactSimulator"));
const RulesPage = lazy(() => import("@/pages/RulesEngine"));
const Architecture = lazy(() => import("@/pages/Architecture"));

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
              <Route path="/typologies" element={<Typologies />} />
              <Route path="/mcc" element={<MccStudio />} />
              <Route path="/mcc/:category" element={<MccStudio />} />
              <Route path="/mcc-abuse" element={<MccAbuse />} />
              <Route path="/mcc-abuse/:category" element={<MccAbuse />} />
              <Route path="/split" element={<SplitLab />} />
              <Route path="/split/:category" element={<SplitLab />} />
              <Route path="/factoring" element={<Factoring />} />
              <Route path="/factoring/:category" element={<Factoring />} />
              <Route path="/descriptors" element={<Descriptors />} />
              <Route path="/descriptors/:category" element={<Descriptors />} />
              <Route path="/cash" element={<Cash />} />
              <Route path="/cash/:category" element={<Cash />} />
              <Route path="/investigate" element={<Investigation />} />
              <Route path="/investigate/:merchantId" element={<Investigation />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/anatomy" element={<Anatomy />} />
              <Route path="/models" element={<ModelStore />} />
              <Route path="/observatory" element={<Observatory />} />
              <Route path="/simulator" element={<Simulator />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/architecture" element={<Architecture />} />
              <Route path="*" element={<Executive />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </HashRouter>
  );
}
