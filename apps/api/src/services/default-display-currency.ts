import { and, eq, isNull } from "drizzle-orm";
import { Decimal } from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { user } from "../db/schema";
import { loadPortfolioBook } from "./portfolio-book";

/**
 * Give a user with no display currency the one most of their book is in.
 *
 * Without one, a mixed-currency book disagreed with itself: the overview
 * quietly fell back to USD, Dividends showed a dash for every total, Book value
 * was a dash, and Goal sent the reader to Settings. Called after an import, so
 * the first thing a new user sees is one currency, named on the import screen.
 *
 * "Most" by cost basis converted through `fxRateService` — not by row count or
 * nominal sums, which would let a pile of small USD trades outvote a larger
 * euro book. A single-currency book needs no rates. When rates are unavailable
 * nothing is set: guessing would be worse than the fallbacks it replaces.
 *
 * The write is conditional on the setting still being empty, so a choice the
 * user makes concurrently is never overwritten. Returns the currency it set,
 * or null when it set nothing.
 */
export async function setDefaultDisplayCurrency(
  db: Database,
  userId: string,
  fxRateService?: IFxRateService,
): Promise<string | null> {
  const book = await loadPortfolioBook(db, userId);
  if (book.targetCurrency !== null) return null;

  const costByCurrency = new Map<string, Decimal>();
  for (const p of book.positions) {
    const cost = p.costBasis.toDecimal();
    costByCurrency.set(p.currency, (costByCurrency.get(p.currency) ?? new Decimal(0)).plus(cost));
  }
  const currencies = [...costByCurrency.keys()];
  if (currencies.length === 0) return null;

  let chosen: string;
  if (currencies.length === 1) {
    chosen = currencies[0]!;
  } else {
    if (!fxRateService) return null;
    const pivot = currencies[0]!;
    let rates: Map<string, Decimal>;
    try {
      rates = await fxRateService.getRates(
        pivot,
        currencies.filter((c) => c !== pivot),
      );
    } catch {
      return null;
    }
    // Rates are target/source, so source -> pivot DIVIDES (as in every view).
    let best: { currency: string; value: Decimal } | null = null;
    for (const [currency, cost] of costByCurrency) {
      let value = cost;
      if (currency !== pivot) {
        const rate = rates.get(currency);
        if (!rate || rate.isZero()) return null;
        value = cost.dividedBy(rate);
      }
      if (best === null || value.greaterThan(best.value)) best = { currency, value };
    }
    chosen = best!.currency;
  }

  const updated = await db
    .update(user)
    .set({ displayCurrency: chosen })
    .where(and(eq(user.id, userId), isNull(user.displayCurrency)))
    .returning({ id: user.id });
  return updated.length > 0 ? chosen : null;
}
