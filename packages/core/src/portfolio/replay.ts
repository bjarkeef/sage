import { Decimal } from "../money/decimal";
import type { CurrencyCode } from "../money/currency";
import { comparePositionTransactions, type PositionTransaction } from "./positions";

/** Holdings state at a single point in time. */
export interface HoldingsSnapshot {
  /** symbol -> quantity held (only symbols with non-zero history entries) */
  quantities: Map<string, Decimal>;
  /** currency -> cumulative net invested */
  invested: Map<string, Decimal>;
  /**
   * symbol -> cumulative net invested in that symbol's own transaction
   * currency (buys +, sells −; splits and dividends are no-ops). Lets a
   * consumer attribute cost to the same symbols it can value, so a symbol
   * with no market price contributes neither value nor flow.
   *
   * **This is a cumulative NATIVE total and must never be divided by a
   * per-date exchange rate.** Doing so re-prices flows that already happened,
   * so a purchase made years ago appears to change price whenever FX moves.
   * To state cost basis in another currency, use
   * {@link replayConvertedInvested}, which converts each flow at the rate of
   * the day it was actually paid.
   */
  investedBySymbol: Map<string, Decimal>;
}

/**
 * Net cost-basis movement a transaction causes, in its own currency: buys add,
 * sells subtract, splits and dividends move none (null).
 *
 * The single definition of which transactions move cost basis and by how much.
 * {@link replayHoldings} and {@link replayConvertedInvested} both accumulate
 * through it, so a change to sell handling or split treatment lands in both
 * rather than drifting between a core rule and a copy of it.
 */
export function investedDelta(tx: PositionTransaction): Decimal | null {
  const signed = signedQuantity(tx);
  return signed === null ? null : tx.price.toDecimal().times(signed);
}

/**
 * Quantity a transaction adds to a position: buys +, sells −. Null for the
 * types that do not move quantity additively — splits (multiplicative) and
 * dividends (no effect).
 */
export function signedQuantity(tx: PositionTransaction): Decimal | null {
  if (tx.type === "buy") return tx.quantity;
  if (tx.type === "sell") return tx.quantity.negated();
  return null;
}

/** A replayed, queryable timeline of holdings built from a transaction history. */
export interface HoldingsTimeline {
  /** "YYYY-MM-DD"; null when no transactions */
  firstTransactionDate: string | null;
  /** every symbol ever transacted */
  symbols: string[];
  /** currency of the symbol's first transaction */
  currencyOf(symbol: string): string;
  /** state at end of the given date */
  asOf(date: string): HoldingsSnapshot;
}

/** Format a Date as a UTC "YYYY-MM-DD" string. Trade dates are constructed as
 *  UTC midnight throughout the codebase; local getters would roll the calendar
 *  date back a day on negative-UTC-offset hosts. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cloneSnapshot(snapshot: HoldingsSnapshot): HoldingsSnapshot {
  return {
    quantities: new Map(snapshot.quantities),
    invested: new Map(snapshot.invested),
    investedBySymbol: new Map(snapshot.investedBySymbol),
  };
}

interface DatedSnapshot {
  date: string;
  snapshot: HoldingsSnapshot;
}

/**
 * Replay a flat list of transactions (across all symbols) into a queryable
 * timeline of per-date holdings: quantity per symbol and net invested per
 * currency. Buys add quantity and invested; sells subtract both; splits
 * multiply quantity only (invested is unaffected, mirroring computePositions'
 * cost-basis-preserving treatment); dividends affect neither.
 *
 * Transactions are grouped by UTC calendar date and applied in trade-date
 * order; a snapshot is captured after each distinct date. `asOf` binary-searches this sorted snapshot array rather than
 * rescanning the transaction list.
 */
export function replayHoldings(txs: PositionTransaction[]): HoldingsTimeline {
  const ordered = [...txs].sort(comparePositionTransactions);

  const symbolCurrency = new Map<string, CurrencyCode>();
  const symbolOrder: string[] = [];
  for (const tx of ordered) {
    if (!symbolCurrency.has(tx.symbol)) {
      symbolCurrency.set(tx.symbol, tx.price.currency);
      symbolOrder.push(tx.symbol);
    }
  }

  const snapshots: DatedSnapshot[] = [];
  const running: HoldingsSnapshot = {
    quantities: new Map(),
    invested: new Map(),
    investedBySymbol: new Map(),
  };

  let i = 0;
  while (i < ordered.length) {
    const dateKey = toDateKey(ordered[i]!.tradeDate);
    while (i < ordered.length && toDateKey(ordered[i]!.tradeDate) === dateKey) {
      const tx = ordered[i]!;
      applyTransaction(running, tx);
      i += 1;
    }
    snapshots.push({ date: dateKey, snapshot: cloneSnapshot(running) });
  }

  const firstTransactionDate = ordered.length > 0 ? toDateKey(ordered[0]!.tradeDate) : null;
  const emptySnapshot: HoldingsSnapshot = {
    quantities: new Map(),
    invested: new Map(),
    investedBySymbol: new Map(),
  };

  return {
    firstTransactionDate,
    symbols: symbolOrder,
    currencyOf(symbol: string): string {
      const currency = symbolCurrency.get(symbol);
      if (currency === undefined) {
        throw new Error(`replayHoldings: unknown symbol "${symbol}"`);
      }
      return currency;
    },
    asOf(date: string): HoldingsSnapshot {
      const index = lastIndexAtOrBefore(snapshots, date);
      // Copy on read: callers must not be able to mutate the timeline's
      // internal state through the returned maps.
      if (index === -1) return cloneSnapshot(emptySnapshot);
      return cloneSnapshot(snapshots[index]!.snapshot);
    },
  };
}

/**
 * Looks up the divisor that converts one unit of `currency` into the reporting
 * currency on `date`: **units of `currency` per 1 reporting unit**, so a native
 * amount is DIVIDED by it. Null when the pair cannot be priced that day.
 *
 * @param date ISO `YYYY-MM-DD`.
 */
export type FlowRateLookup = (date: string, currency: CurrencyCode) => Decimal | null;

/** Cumulative cost basis per symbol, stated in a single reporting currency. */
export interface ConvertedInvestedTimeline {
  /**
   * Cost basis in `symbol` as of `date`, in the reporting currency. Null when
   * the symbol has no cost-basis flows on or before `date`, or when it appears
   * in {@link unconvertible}.
   */
  investedOn(symbol: string, date: string): Decimal | null;
  /**
   * Symbols with at least one flow the lookup could not price. Their cost is
   * withheld on EVERY date rather than reported as a partial sum — a cost basis
   * missing one of its purchases is worse than no cost basis at all.
   */
  unconvertible: ReadonlySet<string>;
}

/**
 * Replay cost basis into one reporting currency, converting each flow at the
 * rate of the day it was actually paid and only then accumulating.
 *
 * This is the honest counterpart to {@link HoldingsSnapshot.investedBySymbol}:
 * converting that cumulative native total at some later date's rate makes a
 * past purchase appear to change price whenever FX moves, which no chart may
 * ever imply. Both walk the same rules via {@link investedDelta}.
 *
 * A same-currency book can pass a lookup that always returns 1 and get exactly
 * the native figures back.
 */
export function replayConvertedInvested(
  txs: PositionTransaction[],
  rateOn: FlowRateLookup,
): ConvertedInvestedTimeline {
  const ordered = [...txs].sort(comparePositionTransactions);
  const unconvertible = new Set<string>();
  const running = new Map<string, Decimal>();
  /** symbol -> ascending, one entry per date, mirroring `replayHoldings`. */
  const bySymbol = new Map<string, { date: string; cumulative: Decimal }[]>();

  for (const tx of ordered) {
    const delta = investedDelta(tx);
    if (delta === null) continue; // splits and dividends move no cost basis
    const dateKey = toDateKey(tx.tradeDate);
    const divisor = rateOn(dateKey, tx.price.currency);
    if (divisor === null || divisor.isZero()) {
      unconvertible.add(tx.symbol);
      continue;
    }
    const cumulative = (running.get(tx.symbol) ?? new Decimal(0)).plus(delta.dividedBy(divisor));
    running.set(tx.symbol, cumulative);

    const list = bySymbol.get(tx.symbol) ?? [];
    const last = list[list.length - 1];
    // One entry per date: same-day flows collapse into a single snapshot, so
    // `investedOn` reports end-of-day cost exactly as `asOf` reports holdings.
    if (last && last.date === dateKey) last.cumulative = cumulative;
    else list.push({ date: dateKey, cumulative });
    bySymbol.set(tx.symbol, list);
  }

  return {
    unconvertible,
    investedOn(symbol: string, date: string): Decimal | null {
      if (unconvertible.has(symbol)) return null;
      const list = bySymbol.get(symbol);
      if (list === undefined || list.length === 0) return null;
      let lo = 0;
      let hi = list.length - 1;
      let found: Decimal | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid]!.date <= date) {
          found = list[mid]!.cumulative;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found;
    },
  };
}

function applyTransaction(running: HoldingsSnapshot, tx: PositionTransaction): void {
  if (tx.type === "split") {
    const current = running.quantities.get(tx.symbol);
    if (current !== undefined) {
      running.quantities.set(tx.symbol, current.times(tx.quantity));
    }
    return;
  }

  const signedQty = signedQuantity(tx);
  const delta = investedDelta(tx);
  if (signedQty === null || delta === null) return; // dividend — moves neither

  const currentQty = running.quantities.get(tx.symbol) ?? new Decimal(0);
  running.quantities.set(tx.symbol, currentQty.plus(signedQty));

  const currency = tx.price.currency;
  const currentInvested = running.invested.get(currency) ?? new Decimal(0);
  running.invested.set(currency, currentInvested.plus(delta));

  const currentBySymbol = running.investedBySymbol.get(tx.symbol) ?? new Decimal(0);
  running.investedBySymbol.set(tx.symbol, currentBySymbol.plus(delta));
}

/** Binary search for the last snapshot with date <= target; -1 if none. */
function lastIndexAtOrBefore(snapshots: DatedSnapshot[], target: string): number {
  let lo = 0;
  let hi = snapshots.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid]!.date <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
