import { Decimal, computeDisposals, computePositions, type PositionTransaction } from "@sage/core";
import { toPositionTransaction } from "../lib/to-position-transaction";
import type { TransactionRow } from "./portfolio-book";
import type { SeriesFxLookup } from "./valuation-series";

/**
 * What a book has made over its whole life, in the reporting currency.
 *
 * Sage reported "total return" as unrealised gain plus gross dividends on the
 * holdings still open. That is a real quantity but not one anybody asks for:
 * on the reporting book it came to 8,203.66 against a broker's 2,904.68 for
 * the open positions and 23,355.74 for the book's life. It was a third number,
 * between two the holder could recognise and equal to neither, because it
 * counted income from the positions it still held while ignoring every sale
 * and the tax on every payment.
 *
 * The two parts here are the ones it was missing. Each converts at the date it
 * belongs to, never at today's rate — a sale made in 2024 was worth what the
 * krone was worth in 2024.
 */
export interface LifetimeReturn {
  /** Gains and losses on everything sold, cost at its purchase date and
   *  proceeds at the sale's. */
  realised: Decimal;
  /** Dividends and interest actually banked: gross less the tax withheld. */
  income: Decimal;
  /** What the still-open positions cost to acquire, converted at `asOf`.
   *  Subtract from today's market value for the unrealised third of the sum. */
  openCost: Decimal;
  /** True when some flow could not be priced and was left out, so the totals
   *  are short rather than wrong. */
  incomplete: boolean;
  /** True when some conversion fell back to the spot rate. */
  approximated: boolean;
}

/**
 * Realised gains and income banked, over the entire ledger.
 *
 * `unrealised` is deliberately not here: it belongs to the positions as they
 * stand today and every caller already has it. Adding the three is the caller's
 * job, which keeps this function about the two halves Sage was missing.
 */
export function computeLifetimeReturn(
  rows: TransactionRow[],
  fxLookup: SeriesFxLookup,
  targetCurrency: string,
  /** Date to price open cost at — the series' last date, so the unrealised
   *  third is stated against the same day its market value is. */
  asOf: string,
): LifetimeReturn {
  let incomplete = false;
  let approximated = false;

  /** Convert a native amount as of the date it was paid. */
  const convert = (amount: Decimal, currency: string, date: string): Decimal | null => {
    if (currency === targetCurrency) return amount;
    const conversion = fxLookup.rateOn(date, currency);
    if (!conversion) {
      incomplete = true;
      return null;
    }
    if (conversion.approximated) approximated = true;
    return amount.dividedBy(conversion.divisor);
  };

  // Fees ride along as their own currency; each disposal converts its cost and
  // its proceeds separately, so a lot bought in kroner and sold in dollars —
  // which three of the reporting book's symbols were — needs no special case.
  const rateOn = (date: string, currency: string): Decimal | null => {
    const conversion = fxLookup.rateOn(date, currency);
    return conversion ? conversion.divisor : null;
  };
  const txs: PositionTransaction[] = rows.map((row) => toPositionTransaction(row, rateOn));

  let realised = new Decimal(0);
  for (const d of computeDisposals(txs)) {
    const soldOn = d.soldOn.toISOString().slice(0, 10);
    const acquiredOn = d.acquiredOn.toISOString().slice(0, 10);
    const proceeds = convert(d.proceeds.toDecimal(), d.proceeds.currency, soldOn);
    const cost = convert(d.cost.toDecimal(), d.cost.currency, acquiredOn);
    if (proceeds === null || cost === null) continue;
    realised = realised.plus(proceeds).minus(cost);
  }

  // Income from the LEDGER, not from provider history times shares held.
  // The synthetic figure the position cards carry is gross and covers only
  // holdings still open; this is the cash that actually landed, on everything
  // ever held, after the tax that was taken off it.
  let income = new Decimal(0);
  for (const row of rows) {
    if (row.type !== "dividend") continue;
    const gross = convert(new Decimal(row.quantity).times(row.price), row.currency, row.tradeDate);
    if (gross === null) continue;
    income = income.plus(gross);
    if (row.fee == null || row.fee === "") continue;
    const withheld = convert(new Decimal(row.fee), row.feeCurrency ?? row.currency, row.tradeDate);
    if (withheld === null) continue;
    income = income.minus(withheld);
  }

  // Cost of what is still held, at one date. Unlike the two figures above,
  // this deliberately does NOT convert at each purchase's own date: it is
  // subtracted from a market value stated at `asOf`, and mixing the two dates
  // would book a currency move as a gain on shares nobody sold. The portfolio
  // card does the same, so the two pages state one unrealised figure.
  let openCost = new Decimal(0);
  for (const position of computePositions(txs)) {
    const converted = convert(position.costBasis.toDecimal(), position.costBasis.currency, asOf);
    if (converted === null) continue;
    openCost = openCost.plus(converted);
  }

  return { realised, income, openCost, incomplete, approximated };
}
