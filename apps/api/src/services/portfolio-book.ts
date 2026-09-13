import { eq, inArray } from "drizzle-orm";
import { Decimal, computePositions, type Position, type PositionTransaction } from "@sage/core";
import type { Database } from "../db/client";
import { getUserPortfolio } from "../auth";
import { fxRateDaily, transaction, user } from "../db/schema";
import { toPositionTransaction } from "../lib/to-position-transaction";

export type TransactionRow = typeof transaction.$inferSelect;

/**
 * Shared ledger snapshot for a user's default portfolio.
 * Loaded once per request and handed to portfolio / income / diversification /
 * valuation builders so the dashboard does not re-select and re-FIFO N times.
 */
export interface PortfolioBook {
  userId: string;
  portfolioId: string;
  /** Resolved display currency (query or user setting); may be null. */
  targetCurrency: string | null;
  rows: TransactionRow[];
  txs: PositionTransaction[];
  positions: Position[];
}

/**
 * A date/currency rate lookup, loaded only when some fee needs converting.
 *
 * Nearly every fee is already in the currency of its own trade, so the usual
 * answer here is "no query at all". The exceptions matter: the reporting book
 * has four USD purchases charged in DKK at around 90 kroner each, one of them
 * still open. Dropping those would understate that holding's cost by 3.8%.
 *
 * Loads the whole ECB series for the currencies involved rather than one row
 * per flow — the table is small, the alternative is a query per transaction,
 * and each lookup has to fall back to the most recent rate on or before its
 * date anyway because the series has no weekend rows.
 */
export async function feeRateLookup(
  db: Database,
  rows: TransactionRow[],
): Promise<((date: string, currency: string) => Decimal | null) | undefined> {
  const needed = new Set<string>();
  for (const row of rows) {
    if (row.fee == null || row.fee === "" || new Decimal(row.fee).isZero()) continue;
    if (!row.feeCurrency || row.feeCurrency === row.currency) continue;
    needed.add(row.feeCurrency);
    needed.add(row.currency);
  }
  needed.delete("EUR"); // the ECB base carries no row of its own
  if (needed.size === 0) return undefined;

  const fxRows = await db
    .select({ date: fxRateDaily.date, currency: fxRateDaily.currency, rate: fxRateDaily.rate })
    .from(fxRateDaily)
    .where(inArray(fxRateDaily.currency, [...needed]));

  const byCurrency = new Map<string, { date: string; rate: Decimal }[]>();
  for (const r of fxRows) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push({ date: r.date, rate: new Decimal(r.rate) });
    byCurrency.set(r.currency, list);
  }
  for (const list of byCurrency.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));

  return (date, currency) => {
    if (currency === "EUR") return new Decimal(1);
    const list = byCurrency.get(currency);
    if (!list || list.length === 0) return null;
    let lo = 0;
    let hi = list.length - 1;
    let found: Decimal | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.date <= date) {
        found = list[mid]!.rate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  };
}

export async function loadPortfolioBook(
  db: Database,
  userId: string,
  opts: { currency?: string | null } = {},
): Promise<PortfolioBook> {
  const { id: portfolioId } = await getUserPortfolio(db, userId);

  let targetCurrency = opts.currency ?? null;
  if (!targetCurrency) {
    const [userRow] = await db
      .select({ displayCurrency: user.displayCurrency })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    targetCurrency = userRow?.displayCurrency ?? null;
  }

  const rows = await db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId));
  const rateOn = await feeRateLookup(db, rows);
  const txs = rows.map((row) => toPositionTransaction(row, rateOn));
  const positions = computePositions(txs);

  return { userId, portfolioId, targetCurrency, rows, txs, positions };
}
