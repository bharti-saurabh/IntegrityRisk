// Lightweight text similarity — no external embedding service required.

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 1 = identical, 0 = completely different (normalized Levenshtein). */
export function normalizedSimilarity(a: string, b: string): number {
  const A = a.toUpperCase().trim();
  const B = b.toUpperCase().trim();
  const maxLen = Math.max(A.length, B.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(A, B) / maxLen;
}

export function charNgrams(s: string, n = 3): Set<string> {
  const t = ` ${s.toUpperCase().replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) grams.add(t.slice(i, i + n));
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export function ngramSimilarity(a: string, b: string): number {
  return jaccard(charNgrams(a), charNgrams(b));
}

const GENERIC_TOKENS = new Set([
  "LLC", "INC", "GROUP", "SVCS", "SERVICES", "TRADING", "GLOBAL", "ONLINE",
  "STORE", "CO", "CORP", "HOLDINGS", "VARIES", "MULTI",
]);

export function genericTokenRatio(descriptor: string): number {
  const tokens = descriptor.toUpperCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.filter((t) => GENERIC_TOKENS.has(t)).length / tokens.length;
}

/** Heuristic for random-character strings (low vowel ratio, mixed case runs). */
export function randomCharScore(descriptor: string): number {
  const letters = descriptor.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return 0;
  const vowels = (letters.match(/[aeiouAEIOU]/g) ?? []).length;
  const vowelRatio = vowels / letters.length;
  // Natural English text ~0.38 vowels; very low or very high looks synthetic.
  return Math.max(0, Math.min(1, Math.abs(vowelRatio - 0.38) / 0.3));
}
