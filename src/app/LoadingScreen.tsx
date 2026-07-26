import { useAppStore } from "@/stores/appStore";
import { ProgressBar } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";

export function LoadingScreen() {
  const progress = useAppStore((s) => s.progress);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const load = useAppStore((s) => s.load);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/30 to-violet/30 text-cyan animate-pulseglow">
          <Icon name="Shield" size={26} />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Integrity Intelligence Command Center</h1>
        <p className="mt-1 text-xs text-ink-3">
          Detecting MCC miscoding, merchant laundering, and category-code abuse
        </p>

        {status === "error" ? (
          <div className="mt-8 rounded-xl border border-critical/40 bg-critical/10 p-4 text-left">
            <div className="text-sm font-semibold text-critical">Engine failed to initialize</div>
            <div className="mt-1 font-mono text-xs text-ink-2">{error}</div>
            <button
              onClick={() => void load()}
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="mt-8">
            <ProgressBar value={progress.pct} />
            <div className="mt-3 flex items-center justify-between text-xs text-ink-3 tnum">
              <span>{progress.phase || "Initializing engine"}</span>
              <span>{Math.round(progress.pct)}%</span>
            </div>
            <div className="mt-6 text-[11px] text-ink-3">
              Generating a synthetic portfolio, engineering features, and scoring models in a
              background worker. All data is synthetic.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
