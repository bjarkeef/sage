import { and, eq } from "drizzle-orm";
import { Decimal } from "@sage/core";
import type { Database } from "../db/client";
import { customHolding, customIncome, transaction } from "../db/schema";
import { resolvePricePoints, type PricePoint } from "../market-data/manual-price-provider";

/** Price on a date: the latest point at or before it, zero before the first. */
export function priceOn(points: PricePoint[], date: string): Decimal {
  let price = new Decimal(0);
  for (const p of points) {
    if (p.date > date) break;
    price = p.price;
  }
  return price;
}

/**
 * Rewrite a custom holding's reinvested payments from units credited at a price
 * of zero into the payment and the buy it pays for — Snowball's own model.
 *
 * As zero-price units the income was invisible to everything that reads the
 * ledger's dividends, and the units cost nothing: the money was right in total
 * return but in the wrong place, sitting in unrealised gain, and a savings
 * account's average cost read below its unit price. Now the payment is a
 * dividend of its gross with the tax withheld as its fee, and the net buys
 * units at that day's price.
 *
 * Idempotent: a converted buy no longer has a price of zero. A credit whose day
 * has no price is left alone — there is nothing honest to value it at. The
 * import ledger keeps pointing at the buy, so a re-import of the old export
 * still recognises the payment (see `legacyRowHash` in the importer).
 */
export async function convertReinvestCredits(
  db: Database,
  portfolioId: string,
  symbol: string,
): Promise<number> {
  const credits = await db
    .select()
    .from(transaction)
    .where(
      and(
        eq(transaction.portfolioId, portfolioId),
        eq(transaction.instrumentSymbol, symbol),
        eq(transaction.type, "buy"),
        eq(transaction.price, "0"),
      ),
    );
  const zero = credits.filter((c) => new Decimal(c.price).isZero());
  if (zero.length === 0) return 0;

  const points = await resolvePricePoints(db, symbol);
  let converted = 0;
  for (const credit of zero) {
    const price = priceOn(points, credit.tradeDate);
    if (price.isZero()) continue;
    const fee =
      credit.fee && (credit.feeCurrency ?? credit.currency) === credit.currency
        ? new Decimal(credit.fee)
        : new Decimal(0);
    const gross = new Decimal(credit.quantity).times(price).plus(fee);

    await db.transaction(async (dbtx) => {
      const [payment] = await dbtx
        .insert(transaction)
        .values({
          portfolioId,
          instrumentSymbol: symbol,
          type: "dividend",
          quantity: "1",
          price: gross.toFixed(),
          currency: credit.currency,
          fee: fee.isZero() ? null : fee.toFixed(),
          feeCurrency: fee.isZero() ? null : credit.currency,
          tradeDate: credit.tradeDate,
          source: credit.source,
        })
        .returning({ id: transaction.id });
      await dbtx
        .update(transaction)
        .set({ price: price.toFixed(), fee: null, feeCurrency: null })
        .where(eq(transaction.id, credit.id));
      await dbtx
        .update(customIncome)
        .set({ transactionId: payment!.id, reinvestTransactionId: credit.id })
        .where(eq(customIncome.transactionId, credit.id));
    });
    converted += 1;
  }
  return converted;
}

/** Convert every custom holding's zero-price credits. Run at startup, after
 *  migrations, so no reader ever sees the old shape. */
export async function convertAllReinvestCredits(db: Database): Promise<number> {
  const holdings = await db
    .select({ symbol: customHolding.symbol, portfolioId: customHolding.portfolioId })
    .from(customHolding);
  let total = 0;
  for (const h of holdings) {
    try {
      total += await convertReinvestCredits(db, h.portfolioId, h.symbol);
    } catch (err) {
      console.warn(
        `reinvest credit conversion failed for ${h.symbol}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return total;
}
