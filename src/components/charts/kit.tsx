import type { ReactNode } from "react";

// Shared chart theme constants + a light-theme tooltip used across Recharts views.
export const CHART = {
  grid: "#e6ebf3",
  axis: "#64748b",
  cyan: "#2563eb",
  violet: "#7c3aed",
  amber: "#d97706",
  rose: "#e11d48",
  green: "#059669",
};

export function ChartTooltip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
  fmt?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-card backdrop-blur-sm">
      {label != null ? <div className="mb-1 font-semibold text-ink">{label}</div> : null}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 tnum">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-3">{p.name}</span>
          <span className="ml-auto font-medium text-ink">
            {typeof p.value === "number" && fmt ? fmt(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="micro-label">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
