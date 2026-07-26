export const clamp = (x: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, x));

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp(Math.floor((p / 100) * (s.length - 1)), 0, s.length - 1);
  return s[idx];
}

export function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Shannon entropy of a categorical distribution given raw counts. */
export function entropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function zScore(x: number, m: number, sd: number): number {
  return sd > 1e-9 ? (x - m) / sd : 0;
}

/** Logistic squash to 0..100. */
export function logistic100(x: number, k = 1, x0 = 0): number {
  return 100 / (1 + Math.exp(-k * (x - x0)));
}

export function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
