import { inArray } from "drizzle-orm";
import type { IAnalystRatingsProvider, AnalystRatings } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { analystRatingsCache, type StoredAnalystRatings } from "../db/schema";

const RATINGS_TTL_MS = 24 * 3600_000;
const BUDGET = 12;

export function toStoredRatings(r: AnalystRatings): StoredAnalystRatings {
  const money = (m: AnalystRatings["targets"]["low"]) => (m ? m.toJSON() : null);
  return {
    consensusKey: r.consensusKey,
    distribution: r.distribution,
    targets: {
      low: money(r.targets.low),
      mean: money(r.targets.mean),
      high: money(r.targets.high),
      median: money(r.targets.median),
    },
    currentPrice: money(r.currentPrice),
    analystCount: r.analystCount,
    asOf: r.asOf.toISOString(),
    upgradeHistory: r.upgradeHistory.map((h) => ({
      firm: h.firm,
      fromGrade: h.fromGrade,
      toGrade: h.toGrade,
      action: h.action,
      date: h.date.toISOString(),
    })),
  };
}

async function upsertRatings(
  db: Database,
  symbol: string,
  data: StoredAnalystRatings | null,
): Promise<void> {
  await db
    .insert(analystRatingsCache)
    .values({ symbol, data, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: analystRatingsCache.symbol,
      set: { data, fetchedAt: new Date() },
    });
}

let inFlight = false;
async function triggerStaleRatingsSync(
  db: Database,
  provider: IAnalystRatingsProvider,
  symbols: string[],
): Promise<void> {
  if (inFlight || symbols.length === 0) return;
  inFlight = true;
  try {
    const rows = await db
      .select({ symbol: analystRatingsCache.symbol, fetchedAt: analystRatingsCache.fetchedAt })
      .from(analystRatingsCache)
      .where(inArray(analystRatingsCache.symbol, symbols));
    const last = new Map<string, Date | null>(symbols.map((s) => [s, null]));
    for (const r of rows) last.set(r.symbol, r.fetchedAt);
    const cutoff = Date.now() - RATINGS_TTL_MS;
    const picked = [...last]
      .filter(([, at]) => at === null || at.getTime() <= cutoff)
      .map(([s]) => s)
      .slice(0, BUDGET);
    for (const symbol of picked) {
      try {
        const fresh = await provider.getAnalystRatings(symbol);
        await upsertRatings(db, symbol, fresh ? toStoredRatings(fresh) : null);
      } catch (err) {
        console.warn(
          `ratings sync failed for ${symbol}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } finally {
    inFlight = false;
  }
}

export async function getSymbolRatings(
  db: Database,
  provider: IAnalystRatingsProvider,
  symbol: string,
): Promise<StoredAnalystRatings | null> {
  const [row] = await db
    .select()
    .from(analystRatingsCache)
    .where(inArray(analystRatingsCache.symbol, [symbol]));
  if (row) {
    if (row.fetchedAt.getTime() <= Date.now() - RATINGS_TTL_MS) {
      void triggerStaleRatingsSync(db, provider, [symbol]).catch(() => {});
    }
    return row.data ?? null;
  }
  const fresh = await provider.getAnalystRatings(symbol);
  const stored = fresh ? toStoredRatings(fresh) : null;
  await upsertRatings(db, symbol, stored);
  return stored;
}
