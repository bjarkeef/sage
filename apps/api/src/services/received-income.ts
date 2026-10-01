import { and, eq, inArray } from "drizzle-orm";
import {
  Decimal,
  buildReceivedDividends,
  computeRetroactiveIncome,
  type DividendHistoryRow,
  type ReceivedDividendRow,
} from "@sage/core";
import type { Database } from "../db/client";
import { customHolding, customIncome, dividendHistory } from "../db/schema";
import type { PortfolioBook } from "./portfolio-book";

/**
 * Every dividend this book actually received — the ONE producer of "received"
 * for /dividends, /holdings and the asset page (spec decision, 2026-10-01).
 *
 * Two sources, both recorded fact, both GROSS (the client applies tax):
 * - ledger `dividend` transactions dated today or earlier (`buildReceivedDividends`);
 * - reinvested custom-income payments, which the ledger records as a price-0
 *   `buy` with the income fact only in the paired `dividend_history` row
 *   (`source: "custom"`). Those are rebuilt as amountPerShare × shares held on
 *   the payment date, using the full `txs` timeline so a since-sold holding's
 *   history survives. A history row that already has a ledger `dividend` row
 *   on the same day, or whose `custom_income` row is a tombstone (the user
 *   deleted that payment), is skipped — nothing is counted twice, and nothing
 *   deleted comes back.
 *
 * Provider dividend history × shares is NOT received income and is never read
 * here: it was /holdings' and the asset page's old producer, and it disagreed
 * with /dividends whenever a broker paid something other than the announced
 * amount.
 *
 * Accepts a one-symbol book (the asset route passes only that symbol's rows):
 * every query below is scoped to the symbols in `rows`.
 */
export async function loadReceivedIncome(
  db: Database,
  book: Pick<PortfolioBook, "portfolioId" | "rows" | "txs">,
  todayIso: string,
): Promise<ReceivedDividendRow[]> {
  const { portfolioId, rows, txs } = book;

  const ledger = buildReceivedDividends(
    rows.map((t) => ({
      symbol: t.instrumentSymbol,
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
      tradeDate: t.tradeDate,
      source: t.source ?? null,
    })),
    todayIso,
  );

  const bookSymbols = [...new Set(rows.map((t) => t.instrumentSymbol))];
  const reinvestCustomHoldingRows =
    bookSymbols.length > 0
      ? await db
          .select({ symbol: customHolding.symbol })
          .from(customHolding)
          .where(
            and(
              eq(customHolding.portfolioId, portfolioId),
              eq(customHolding.reinvest, true),
              inArray(customHolding.symbol, bookSymbols),
            ),
          )
      : [];
  const reinvestSymbols = new Set(reinvestCustomHoldingRows.map((h) => h.symbol));

  const customDividendHistoryRows =
    reinvestSymbols.size > 0
      ? await db
          .select()
          .from(dividendHistory)
          .where(
            and(
              inArray(dividendHistory.symbol, [...reinvestSymbols]),
              eq(dividendHistory.source, "custom"),
            ),
          )
      : [];

  const customIncomeRows =
    reinvestSymbols.size > 0
      ? await db
          .select({
            symbol: customIncome.symbol,
            payDate: customIncome.payDate,
            transactionId: customIncome.transactionId,
          })
          .from(customIncome)
          .where(
            and(
              eq(customIncome.portfolioId, portfolioId),
              inArray(customIncome.symbol, [...reinvestSymbols]),
            ),
          )
      : [];
  const tombstonedPaymentDates = new Set(
    customIncomeRows.filter((r) => r.transactionId === null).map((r) => `${r.symbol}|${r.payDate}`),
  );

  // A `source: custom` history row that already has a ledger `dividend` row on
  // the same day is the non-reinvest case, read above from the ledger — kept as
  // a guard in case `reinvest` was toggled after history existed.
  const dividendTxDates = new Set(
    rows.filter((t) => t.type === "dividend").map((t) => `${t.instrumentSymbol}|${t.tradeDate}`),
  );
  const reinvestDividendHistory: DividendHistoryRow[] = customDividendHistoryRows
    .filter((d) => !dividendTxDates.has(`${d.symbol}|${d.exDate}`))
    .filter((d) => !tombstonedPaymentDates.has(`${d.symbol}|${d.exDate}`))
    .map((d) => ({
      symbol: d.symbol,
      exDate: d.exDate,
      amountPerShare: d.amountPerShare,
      currency: d.currency,
      paymentDate: d.paymentDate,
      paymentDateEstimated: d.paymentDateEstimated,
    }));
  const reinvestReceived: ReceivedDividendRow[] = computeRetroactiveIncome(
    txs,
    reinvestDividendHistory,
  )
    .filter((r) => (r.paymentDate ?? r.exDate) <= todayIso)
    .map((r) => ({
      symbol: r.symbol,
      cashDate: r.paymentDate ?? r.exDate,
      income: r.income,
      currency: r.currency,
      amountPerShare: r.amountPerShare,
      sharesHeld: r.sharesHeld,
    }));

  return [...ledger, ...reinvestReceived].sort(
    (a, b) => a.cashDate.localeCompare(b.cashDate) || a.symbol.localeCompare(b.symbol),
  );
}

export interface ReceivedTotal {
  amount: Decimal;
  /** Rows in another currency that could not be converted — left out of
   *  `amount`, never summed raw. */
  leftOut: number;
}

/**
 * One symbol's received total in `currency`. A row in another currency goes
 * through `convert` (from → `currency`); a row it cannot convert is left out
 * and counted, the same rule /dividends applies with `fxIncomplete`. Null when
 * the symbol has received nothing — "nothing yet" is not a zero amount.
 */
export function receivedTotal(
  rows: ReceivedDividendRow[],
  symbol: string,
  currency: string,
  convert?: (amount: Decimal, from: string) => Decimal | null,
): ReceivedTotal | null {
  const mine = rows.filter((r) => r.symbol === symbol);
  if (mine.length === 0) return null;
  let amount = new Decimal(0);
  let leftOut = 0;
  for (const r of mine) {
    const income = new Decimal(r.income);
    if (r.currency === currency) {
      amount = amount.plus(income);
      continue;
    }
    const converted = convert?.(income, r.currency) ?? null;
    if (converted == null) {
      leftOut += 1;
      continue;
    }
    amount = amount.plus(converted);
  }
  return { amount, leftOut };
}
