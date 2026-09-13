import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import type { CurrencyCode } from "../money/currency";
import { OversellError } from "./errors";

/** One trade for a single instrument, in that instrument's currency. */
export interface PositionTransaction {
  symbol: string;
  type: "buy" | "sell" | "dividend" | "split";
  quantity: Decimal;
  price: Money;
  tradeDate: Date;
  /**
   * Stable secondary sort key for same-calendar-day trades (e.g. createdAt ISO
   * or row UUID). When absent, same-day order is undefined — callers that load
   * from a DB should always pass this so FIFO is deterministic.
   */
  sequence?: string;
  /**
   * What the trade cost to place, in the trade's own currency.
   *
   * A buy's fee is part of what the shares cost, so it belongs in cost basis;
   * a sell's reduces the proceeds. On a dividend it is the tax withheld, which
   * is income the holder never received and never cost-basis — see
   * {@link investedDelta}, which is where the distinction is made.
   *
   * **Must already be in `price.currency`.** Core has no exchange rates, so a
   * fee in another currency is dropped rather than added wrong; the loader
   * converts at the trade date before it gets here.
   */
  fee?: Money;
}

/**
 * A buy's acquisition cost per share, fee included.
 *
 * Fees were recorded from the first import and read by nothing: the column was
 * written, exported and shown on the transaction row, while every figure built
 * on cost basis quietly assumed the shares had been free to buy. On the
 * reporting book that overstated the unrealised gain by 104.56 DKK, 3% of the
 * gain it was reporting, spread across 22 of its 27 holdings.
 *
 * Folding the fee into the lot's per-share cost rather than carrying it beside
 * the lot means splits, partial sells and `averageCost` all keep working
 * unchanged: each is already expressed in terms of this one number.
 */
function lotCostPerShare(tx: PositionTransaction): Money {
  if (!tx.fee || tx.fee.isZero() || tx.quantity.isZero()) return tx.price;
  if (tx.fee.currency !== tx.price.currency) return tx.price; // unconvertible here
  // Shares credited rather than bought — a reinvestment, a DRIP, a bonus issue
  // — carry a price of zero, and a fee on one of those is tax withheld from the
  // income that paid for them, not a cost of acquiring them. Counting it would
  // say the holder spent money they never spent: on the reporting book the
  // savings account's three reinvest rows would have added 255.51 DKK of
  // withholding to its cost.
  if (tx.price.isZero()) return tx.price;
  return tx.price.plus(tx.fee.dividedBy(tx.quantity));
}

/**
 * Same-day type order for long-only FIFO: buys before splits before sells.
 * Dividends are skipped by the lot engine but still ordered last so same-day
 * ties stay deterministic. Without this, a bulk import that stamps every row
 * with the same `createdAt` falls through to UUID order and can process a
 * same-day sell before its matching buy → {@link OversellError}.
 */
const TYPE_ORDER: Record<PositionTransaction["type"], number> = {
  buy: 0,
  split: 1,
  sell: 2,
  dividend: 3,
};

/** Sort by trade date, then type (buy → split → sell → dividend), then sequence. */
export function comparePositionTransactions(
  a: PositionTransaction,
  b: PositionTransaction,
): number {
  const byDate = a.tradeDate.getTime() - b.tradeDate.getTime();
  if (byDate !== 0) return byDate;
  const byType = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
  if (byType !== 0) return byType;
  const sa = a.sequence ?? "";
  const sb = b.sequence ?? "";
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** A computed open holding for a single instrument. */
export interface Position {
  symbol: string;
  currency: CurrencyCode;
  quantity: Decimal;
  costBasis: Money;
  averageCost: Money;
}

interface Lot {
  qty: Decimal;
  price: Money;
}

/**
 * Compute open positions from a flat list of transactions, applying FIFO lot
 * accounting per symbol. Buys add lots at what the shares cost to acquire —
 * price plus the buy's fee, see {@link lotCostPerShare} — and sells consume the
 * oldest lots first. A sell's own fee reduces its proceeds, which is a realised
 * figure and none of this function's business: it leaves the surviving lots
 * exactly as it found them.
 * Dividends are skipped (income-only). Splits multiply lot quantities and divide
 * lot prices, preserving total cost basis.
 * Returns only positions with a positive remaining quantity. Throws
 * {@link OversellError} if a sell would consume more shares than are held.
 */
export function computePositions(transactions: PositionTransaction[]): Position[] {
  const bySymbol = new Map<string, PositionTransaction[]>();
  for (const tx of transactions) {
    const list = bySymbol.get(tx.symbol) ?? [];
    list.push(tx);
    bySymbol.set(tx.symbol, list);
  }

  const positions: Position[] = [];
  for (const [symbol, txs] of bySymbol) {
    const ordered = [...txs].sort(comparePositionTransactions);
    const lots: Lot[] = [];

    for (const tx of ordered) {
      if (tx.type === "dividend") continue;

      if (tx.type === "split") {
        for (const lot of lots) {
          lot.qty = lot.qty.times(tx.quantity);
          lot.price = lot.price.dividedBy(tx.quantity);
        }
        continue;
      }

      if (tx.type === "buy") {
        lots.push({ qty: tx.quantity, price: lotCostPerShare(tx) });
        continue;
      }

      let remaining = tx.quantity;
      while (remaining.greaterThan(0)) {
        const lot = lots[0];
        if (!lot) throw new OversellError(symbol);
        if (lot.qty.lessThanOrEqualTo(remaining)) {
          remaining = remaining.minus(lot.qty);
          lots.shift();
        } else {
          lot.qty = lot.qty.minus(remaining);
          remaining = new Decimal(0);
        }
      }
    }

    const quantity = lots.reduce((sum, lot) => sum.plus(lot.qty), new Decimal(0));
    // Drop residual dust left when buy/sell quantities don't cancel to exact
    // zero (common after broker CSV rounding on cash-style custom holdings).
    // 1e-6 shares is far below any real fractional position we care about.
    if (!quantity.greaterThan(new Decimal("0.000001"))) continue;

    const currency = lots[0]!.price.currency;
    const costBasis = Money.sum(
      lots.map((lot) => lot.price.times(lot.qty)),
      currency,
    );
    positions.push({
      symbol,
      currency,
      quantity,
      costBasis,
      averageCost: costBasis.dividedBy(quantity),
    });
  }

  return positions;
}
