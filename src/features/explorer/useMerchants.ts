import { useEffect, useState } from "react";
import { loadMerchants, type ExplorerMerchant } from "./types";

// Module-level cache so the 1.3MB merchants.json is fetched once per session and
// shared across the Data Explorer, MCC cohorts, and any other consumer.
let cache: ExplorerMerchant[] | null = null;
let inflight: Promise<ExplorerMerchant[]> | null = null;

export function fetchMerchantsCached(): Promise<ExplorerMerchant[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) inflight = loadMerchants().then((rows) => { cache = rows; return rows; });
  return inflight;
}

export function useExplorerMerchants(): { merchants: ExplorerMerchant[] | null; error: string | null } {
  const [merchants, setMerchants] = useState<ExplorerMerchant[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cache) { setMerchants(cache); return; }
    let alive = true;
    fetchMerchantsCached()
      .then((rows) => { if (alive) setMerchants(rows); })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, []);
  return { merchants, error };
}
