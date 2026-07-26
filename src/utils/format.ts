export function fmtCurrency(n: number, compact = false): string {
  if (compact) return `$${fmtCompact(n)}`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function fmtPct(x: number, dp = 0): string {
  return `${(x * 100).toFixed(dp)}%`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function maskCard(cardId: string): string {
  const digits = cardId.replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "0");
  return `•••• ${last4}`;
}

export function relativeDays(ts: number, anchor: number): string {
  const days = Math.round((anchor - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
