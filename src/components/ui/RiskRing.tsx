import { useEffect, useState } from "react";
import type { RiskTier } from "@/types/domain";

const TIER_STROKE: Record<RiskTier, string> = {
  critical: "#dc2626",
  high: "#e11d48",
  elevated: "#d97706",
  watch: "#2563eb",
  clear: "#059669",
};

export function RiskRing({
  score,
  tier,
  size = 132,
  label = "COMPOSITE RISK",
}: {
  score: number;
  tier: RiskTier;
  size?: number;
  label?: string;
}) {
  const [display, setDisplay] = useState(0);
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const from = display;
    const to = score;
    const dur = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const offset = circ * (1 - display / 100);
  const color = TIER_STROKE[tier];

  return (
    <div className="relative inline-flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef2f7" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 1px 4px ${color}40)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold tnum" style={{ color }}>
          {Math.round(display)}
        </div>
        <div className="micro-label mt-0.5 text-center leading-tight">{label}</div>
      </div>
    </div>
  );
}
