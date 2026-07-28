import { useState } from "react";
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
    title: "Scan the merchant book",
    body: "Open the Data Explorer's Risk table: every merchant scored 0–100 by a 7-signal ensemble. Sort, filter by typology, and drill into the highest-risk entities. Nothing here is hardcoded — filters recalculate over the real records.",
    route: "/explorer?view=risk",
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
    title: "Follow the money (factoring)",
    body: "Factoring models pull the cohort of registered outlets settling for undisclosed sub-merchants — surfaced by shared settlement accounts, devices, and known-bad adjacency. Each row lands in the owning team's remediation queue with the variables that flagged it.",
    route: "/factoring",
  },
  {
    title: "Work the queue",
    body: "Alerts become cases with SLAs, dispositions, and an audit trail. Change a status or disposition — it persists to localStorage as an accountable action.",
    route: "/cases",
  },
  {
    title: "Trust the model",
    body: "The observatory reports precision, alert volume and captured exposure against synthetic ground truth — recall/F1/AUC are deliberately omitted because the true positive universe is unknowable for a live book. The impact simulator lets you move the alert threshold and watch the precision/workload/exposure tradeoff live.",
    route: "/observatory",
  },
  {
    title: "You're ready",
    body: "Explore any module from the sidebar, or press ⌘K to jump to any merchant. Everything you see is decision-support on synthetic data — not a final compliance determination.",
    route: "/simulator",
  },
];

export function DemoTour() {
  const navigate = useNavigate();
  const demoStep = useAppStore((s) => s.demoStep);
  const setDemoStep = useAppStore((s) => s.setDemoStep);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const [active, setActive] = useState(false);

  const go = (n: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, n));
    setDemoStep(clamped);
    navigate(STEPS[clamped].route);
  };

  const start = () => {
    setActive(true);
    setDemoStep(0);
    navigate(STEPS[0].route);
  };

  const finish = () => {
    setActive(false);
    resetDemo();
  };

  if (!active) {
    return (
      <button
        onClick={start}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-violet/40 bg-gradient-to-r from-violet/90 to-cyan/90 px-4 py-2.5 text-sm font-semibold text-white shadow-glow hover:opacity-90"
      >
        <Icon name="Play" size={15} /> Start guided demo
      </button>
    );
  }

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
