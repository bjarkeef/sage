import { eq } from "drizzle-orm";
import { computePositions, type Position, type PositionTransaction } from "@sage/core";
import type { Database } from "../db/client";
import { getUserPortfolio } from "../auth";
import { transaction, user } from "../db/schema";
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
  const txs = rows.map(toPositionTransaction);
  const positions = computePositions(txs);

  return { userId, portfolioId, targetCurrency, rows, txs, positions };
}
