import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Icon } from "@/components/ui/Icon";
import { SCENARIO_SPECS } from "@/data/scenarios";

interface TourStep {
  title: string;
  body: string;
  route: string;
}

// Flagship investigation used by the guided tour.
const FLAGSHIP = SCENARIO_SPECS.find((s) => s.primaryTypology === "MCC_MISCODING") ?? SCENARIO_SPECS[0];

const STEPS: TourStep[] = [
  {
    title: "Welcome to the Command Center",
    body: "This is a live analytical demo. A synthetic portfolio of 1,300+ merchants and 100k+ transactions was generated, feature-engineered, and scored in a background worker. Start at the executive view for portfolio exposure.",
    route: "/",
  },
  {
    title: "See it on your data",
    body: "Open the Data Explorer: the raw settlement transactions and the merchant book they roll up into, previewed row by row — then queried live in an in-browser SQL console. Nothing is hardcoded; the whole solution is built directly on this data.",
    route: "/explorer",
  },
  {
    title: "Flagship: MCC miscoding",
    body: `Open the identification models. We run one detection model per prohibited/restricted category (P1–P3). Pick an identification type from the dropdown — "merchants suspected adult, gambling, crypto… but miscoded as something benign" — and you get that attestation team's ready-to-work remediation queue with the significant variables that flagged each merchant.`,
    route: `/mcc`,
  },
  {
    title: "Investigate with AI",
    body: "Launch the autonomous agent. It plans the investigation, pulls internal transaction & graph evidence, runs simulated OSINT (website, WHOIS, registry, watchlists), and streams a cited verdict in real time.",
    route: `/investigate/${FLAGSHIP.merchantId}`,
  },
  {
    title: "Card surcharge abuse",
    body: "The second live typology: merchants adding non-compliant card surcharges. Same pattern as MCC miscoding — behavioural signals surface each merchant into a ready-to-work queue with the variables that flagged it.",
    route: "/surcharge",
  },
  {
    title: "Trust the models",
    body: "The Model Store lists every deployed detection model — one per prohibited/restricted MCC category plus card surcharge — each reporting precision, alert volume and captured exposure against synthetic ground truth. Recall/F1/AUC are deliberately omitted because the true positive universe is unknowable for a live book. Explore any module from the sidebar, or press ⌘K to jump to any merchant — everything here is decision-support on synthetic data, not a final compliance determination.",
    route: "/models",
  },
];

// Launcher — lives in the top header. Starts the guided tour.
export function DemoTourButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const setDemoActive = useAppStore((s) => s.setDemoActive);
  const setDemoStep = useAppStore((s) => s.setDemoStep);

  const start = () => {
    setDemoActive(true);
    setDemoStep(0);
    navigate(STEPS[0].route);
  };

  return (
    <button
      onClick={start}
      title="Take the guided tour of the Command Center"
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-full border border-violet/40 bg-gradient-to-r from-violet/80 to-cyan/80 px-3 py-1 text-[11px] font-semibold text-white shadow-glow transition-opacity hover:opacity-90"
      }
    >
      <Icon name="Play" size={12} /> Guided demo
    </button>
  );
}

export function DemoTour() {
  const navigate = useNavigate();
  const demoStep = useAppStore((s) => s.demoStep);
  const setDemoStep = useAppStore((s) => s.setDemoStep);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const demoActive = useAppStore((s) => s.demoActive);

  const go = (n: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, n));
    setDemoStep(clamped);
    navigate(STEPS[clamped].route);
  };

  const finish = () => resetDemo();

  if (!demoActive) return null;

  const step = STEPS[demoStep];

  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[min(94vw,640px)] -translate-x-1/2 rounded-2xl border border-violet/40 bg-surface/95 p-4 shadow-glow backdrop-blur-md">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/20 text-ai">
          <Icon name="Sparkles" size={16} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">{step.title}</div>
            <div className="text-[11px] text-ink-3 tnum">
              {demoStep + 1} / {STEPS.length}
            </div>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i <= demoStep ? "bg-cyan" : "bg-surface-2"}`}
                />
              ))}
            </div>
            <button onClick={finish} className="rounded-lg px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink">
              Exit
            </button>
            <button
              onClick={() => go(demoStep - 1)}
              disabled={demoStep === 0}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
            >
              Back
            </button>
            {demoStep === STEPS.length - 1 ? (
              <button onClick={finish} className="rounded-lg bg-cyan/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan">
                Finish
              </button>
            ) : (
              <button onClick={() => go(demoStep + 1)} className="rounded-lg bg-cyan/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan">
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
