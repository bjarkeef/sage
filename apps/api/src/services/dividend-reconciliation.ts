import { eq, inArray } from "drizzle-orm";
import {
  Decimal,
  Money,
  dedupeDividends,
  planAutoDividends,
  type PositionTransaction,
} from "@sage/core";
import type { Database } from "../db/client";
import {
  autoDividend,
  dividendHistory,
  instrument,
  portfolio,
  transaction,
  user,
} from "../db/schema";
import { getUserPortfolio } from "../auth";

export const RECONCILE_TTL_MS = 24 * 3600 * 1000;

/**
 * Release the 24h claim, so the next dividend-relevant read reconciles again.
 *
 * For whoever just wrote dividend history for newly held symbols. A new user's
 * first page load reconciles an EMPTY book and claims the slot; the import that
 * follows fetches the history, and without this nothing reconciled it for a day,
 * so a freshly imported book showed none of the dividends it had received.
 */
export async function invalidateReconciliation(db: Database, portfolioId: string): Promise<void> {
  await db.update(portfolio).set({ lastReconciledAt: null }).where(eq(portfolio.id, portfolioId));
}

/**
 * Lazy dividend auto-reconciliation (spec 2026-07-16). Called at the top of
 * dividend-relevant GETs; exits in one indexed read unless 24h have passed.
 * Reads dividend_history as-is — freshness is the existing stale-sync's job.
 *
 * Concurrency: the TTL claim is written up front (cheap best-effort gate);
 * true idempotency comes from auto_dividend's unique (portfolio, symbol,
 * ex_date) — a racing run's conflicting claim inserts nothing, so it also
 * creates no transaction. All writes happen in one DB transaction: a crash
 * can never leave a half-created pair (which would read as a tombstone).
 */
export async function reconcileDividends(db: Database, userId: string): Promise<void> {
  const { id: portfolioId } = await getUserPortfolio(db, userId);
  const [pf] = await db
    .select({ auto: portfolio.autoAddDividends, last: portfolio.lastReconciledAt })
    .from(portfolio)
    .where(eq(portfolio.id, portfolioId));
  if (!pf?.auto) return;
  if (pf.last && Date.now() - pf.last.getTime() < RECONCILE_TTL_MS) return;
  await db
    .update(portfolio)
    .set({ lastReconciledAt: new Date() })
    .where(eq(portfolio.id, portfolioId));

  const txs = await db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId));
  if (txs.length === 0) return;

  // Every symbol ever transacted — sold-out positions still earned dividends
  // while held (full-history backfill).
  const symbols = [...new Set(txs.map((t) => t.instrumentSymbol))];
  // Custom holdings' income is materialized by the custom-income engine with its
  // own ledger; running the dividend auto-reconciler over their dividend_history
  // rows would create a SECOND transaction per payment (double income).
  const customRows = await db
    .select({ symbol: instrument.symbol })
    .from(instrument)
    .where(eq(instrument.assetType, "custom"));
  const customSet = new Set(customRows.map((r) => r.symbol));
  const providerSymbols = symbols.filter((s) => !customSet.has(s));
  if (providerSymbols.length === 0) return;

  const divRows = await db
    .select()
    .from(dividendHistory)
    .where(inArray(dividendHistory.symbol, providerSymbols));
  if (divRows.length === 0) return;

  const ledger = await db
    .select({ symbol: autoDividend.symbol, exDate: autoDividend.exDate })
    .from(autoDividend)
    .where(eq(autoDividend.portfolioId, portfolioId));

  // Withholding, at the user's declared rate.
  //
  // A dividend row's `fee` is the tax taken before the cash landed. Imported
  // rows carry what the broker actually withheld — 34.6% across the reporting
  // book's 158 of them. Rows this reconciler created carried nothing, which
  // states that no tax was withheld, and that is never true of a real payment.
  //
  // The two now mean the same thing but are not equally certain, and the
  // ledger already records which is which: `source = 'auto'` marks a row Sage
  // derived rather than observed. So a reader can tell an estimate from a
  // receipt without a second column, and an import that later supersedes one
  // of these brings the broker's real figure with it.
  //
  // Matches `custom-income-sync`, which has always taxed the income it mints.
  const [userRow] = await db
    .select({ taxRate: user.dividendTaxRate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const taxRate = userRow?.taxRate == null ? new Decimal(0) : new Decimal(userRow.taxRate);

  const positionTxs: PositionTransaction[] = txs.map((t) => ({
    symbol: t.instrumentSymbol,
    type: t.type as PositionTransaction["type"],
    quantity: new Decimal(t.quantity),
    price: Money.of(t.price, t.currency),
    tradeDate: new Date(`${t.tradeDate}T00:00:00Z`),
  }));
  // Same dedupe the analytics apply — multi-provider double-reports must not
  // become double transactions.
  const deduped = dedupeDividends(
    divRows.map((r) => ({
      symbol: r.symbol,
      exDate: r.exDate,
      amountPerShare: r.amountPerShare,
      currency: r.currency,
      paymentDate: r.paymentDate,
      paymentDateEstimated: r.paymentDateEstimated,
    })),
  );

  const plan = planAutoDividends({
    transactions: positionTxs,
    dividends: deduped,
    ledger,
    today: new Date().toISOString().slice(0, 10),
  });
  if (plan.length === 0) return;

  await db.transaction(async (dbtx) => {
    for (const p of plan) {
      const claimed = await dbtx
        .insert(autoDividend)
        .values({ portfolioId, symbol: p.symbol, exDate: p.exDate })
        .onConflictDoNothing()
        .returning({ id: autoDividend.id });
      if (claimed.length === 0) continue; // a concurrent run owns this identity
      const tax = new Decimal(p.quantity).times(p.price).times(taxRate).dividedBy(100);
      const [created] = await dbtx
        .insert(transaction)
        .values({
          portfolioId,
          instrumentSymbol: p.symbol,
          type: "dividend",
          quantity: p.quantity,
          price: p.price,
          currency: p.currency,
          fee: tax.isZero() ? null : tax.toFixed(),
          feeCurrency: tax.isZero() ? null : p.currency,
          tradeDate: p.tradeDate,
          source: "auto",
        })
        .returning({ id: transaction.id });
      await dbtx
        .update(autoDividend)
        .set({ transactionId: created!.id })
        .where(eq(autoDividend.id, claimed[0]!.id));
    }
  });
}
