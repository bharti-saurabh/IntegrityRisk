import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { RiskTier } from "@/types/domain";
import { TIER_BG, TIER_LABELS } from "@/features/cases/actions";

export function Card({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: "cyan" | "critical" | null;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-border bg-surface shadow-card",
        glow === "cyan" && "border-cyan/30 shadow-glow",
        glow === "critical" && "border-critical/30 shadow-glow-critical",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("micro-label", className)}>{children}</div>;
}

export function StatTile({
  label,
  value,
  sub,
  accent = "cyan",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: "cyan" | "violet" | "amber" | "critical" | "ok";
  icon?: ReactNode;
}) {
  const accentClass = {
    cyan: "text-cyan",
    violet: "text-violet",
    amber: "text-amber",
    critical: "text-critical",
    ok: "text-ok",
  }[accent];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <SectionLabel>{label}</SectionLabel>
        {icon ? <span className={clsx("opacity-70", accentClass)}>{icon}</span> : null}
      </div>
      <div className={clsx("mt-2 text-2xl font-bold tnum", accentClass)}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-ink-3 tnum">{sub}</div> : null}
    </Card>
  );
}

export function TierBadge({ tier, small }: { tier: RiskTier; small?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border font-semibold uppercase tracking-wide",
        TIER_BG[tier],
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-cyan/50 bg-cyan/15 text-cyan"
          : "border-border bg-surface-2 text-ink-2 hover:border-ink-3 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  className,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "ai";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-cyan text-white hover:bg-cyan/90 font-semibold shadow-sm",
    ghost: "border border-border bg-surface text-ink-2 hover:text-ink hover:border-ink-3 hover:bg-surface-2",
    danger: "bg-critical text-white hover:bg-critical/90 font-semibold shadow-sm",
    ai: "bg-gradient-to-r from-violet to-cyan text-white font-semibold shadow-sm hover:opacity-90",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
        v,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan to-violet transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      <div className="text-sm font-semibold text-ink-2">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}
