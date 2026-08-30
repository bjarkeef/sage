import { inArray, max } from "drizzle-orm";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { dividendHistory } from "../db/schema";
import { syncAllPositionDividends } from "./dividend-sync";

const TTL_HOURS = 24;
const BUDGET = 5; // symbols per trigger; EODHD free tier is 20 req/day

/**
 * Symbols worth re-syncing, oldest knowledge first: never-synced symbols, then
 * those whose last fetch is older than the TTL. Capped at `budget` so a page
 * load can never burn more than a sliver of the provider quota.
 */
export function pickStaleSymbols(
  lastFetched: Map<string, Date | null>,
  now: Date,
  ttlHours = TTL_HOURS,
  budget = BUDGET,
): string[] {
  const cutoff = now.getTime() - ttlHours * 3600 * 1000;
  const never: string[] = [];
  const stale: { symbol: string; at: number }[] = [];
  for (const [symbol, at] of lastFetched) {
    if (at === null) never.push(symbol);
    else if (at.getTime() <= cutoff) stale.push({ symbol, at: at.getTime() });
  }
  stale.sort((a, b) => a.at - b.at);
  return [...never, ...stale.map((s) => s.symbol)].slice(0, budget);
}

let inFlight = false;

/** Fire-and-forget staleness sync. Serialized: overlapping triggers no-op. */
export async function triggerStaleDividendSync(
  db: Database,
  providers: IMarketDataProvider[],
  symbols: string[],
): Promise<void> {
  if (inFlight || symbols.length === 0) return;
  inFlight = true;
  try {
    const rows = await db
      .select({ symbol: dividendHistory.symbol, last: max(dividendHistory.fetchedAt) })
      .from(dividendHistory)
      .where(inArray(dividendHistory.symbol, symbols))
      .groupBy(dividendHistory.symbol);
    const lastBySymbol = new Map<string, Date | null>(symbols.map((s) => [s, null]));
    for (const r of rows) lastBySymbol.set(r.symbol, r.last);
    const picked = pickStaleSymbols(lastBySymbol, new Date());
    if (picked.length > 0) await syncAllPositionDividends(db, providers, picked);
  } finally {
    inFlight = false;
  }
}
