import { and, eq, inArray, ne, notInArray, or, isNull, sql } from "drizzle-orm";
import { inferDividendCurrency } from "@sage/core";
import type { Database } from "../db/client";
import { dividendHistory, transaction } from "../db/schema";

/** Ledger sources Sage writes itself. Their currency was copied from the
 *  provider rows being judged, so they cannot be evidence about them. */
const DERIVED_SOURCES = ["auto", "custom", "custom-income"];

/**
 * Relabel a symbol's provider dividends when the broker's own bookings show
 * they are in another currency (see `inferDividendCurrency`), and carry the
 * correction to the dividends Sage auto-added from those rows.
 *
 * Providers tag a dividend with the listing's currency, so a EUR-listed fund
 * that distributes in USD arrives as its USD amount labelled EUR — read as EUR,
 * about 12% too much, in received income, the forecast and every total built on
 * them. The amounts are already the right digits; only the label changes.
 *
 * `dividend_history` is per instrument, not per user, and a broker's booking is
 * a fact about the instrument, so evidence from any portfolio corrects it.
 * Idempotent: once relabelled there is nothing left to change.
 */
export async function correctDividendCurrencies(db: Database, symbols: string[]): Promise<void> {
  if (symbols.length === 0) return;
  const providerRows = await db
    .select({
      symbol: dividendHistory.symbol,
      exDate: dividendHistory.exDate,
      paymentDate: dividendHistory.paymentDate,
      amountPerShare: dividendHistory.amountPerShare,
      currency: dividendHistory.currency,
    })
    .from(dividendHistory)
    .where(inArray(dividendHistory.symbol, symbols));
  if (providerRows.length === 0) return;

  const bookedRows = await db
    .select({
      symbol: transaction.instrumentSymbol,
      tradeDate: transaction.tradeDate,
      price: transaction.price,
      currency: transaction.currency,
    })
    .from(transaction)
    .where(
      and(
        inArray(transaction.instrumentSymbol, symbols),
        eq(transaction.type, "dividend"),
        or(isNull(transaction.source), notInArray(transaction.source, DERIVED_SOURCES)),
      ),
    );
  if (bookedRows.length === 0) return;

  for (const symbol of symbols) {
    const provider = providerRows.filter((r) => r.symbol === symbol);
    const corrected = inferDividendCurrency(
      provider,
      bookedRows.filter((r) => r.symbol === symbol),
    );
    if (!corrected) continue;
    const wrong = [...new Set(provider.map((r) => r.currency))].filter((c) => c !== corrected);
    if (wrong.length === 0) continue;

    await db.transaction(async (tx) => {
      await tx
        .update(dividendHistory)
        .set({ currency: corrected })
        .where(and(eq(dividendHistory.symbol, symbol), ne(dividendHistory.currency, corrected)));
      // Auto-added dividends copied the old label; the withheld tax on them was
      // computed in that same currency, so it moves with it.
      await tx
        .update(transaction)
        .set({
          currency: corrected,
          feeCurrency: sql`case when ${transaction.fee} is null then null else ${corrected} end`,
        })
        .where(
          and(
            eq(transaction.instrumentSymbol, symbol),
            eq(transaction.type, "dividend"),
            eq(transaction.source, "auto"),
            inArray(transaction.currency, wrong),
          ),
        );
    });
  }
}
