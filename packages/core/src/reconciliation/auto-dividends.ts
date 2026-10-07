import { Decimal } from "../money/decimal";
import type { PositionTransaction } from "../portfolio/positions";
import type { DividendHistoryRow } from "../portfolio/dividends";
import { buildSharesTimeline, sharesHeldOn } from "../portfolio/dividends";

/** Detection + adoption both use this window (spec: one-to-one, nearest-date,
 *  ±10 days of the cash date). */
export const MATCH_WINDOW_DAYS = 10;

export interface AutoDividendLedgerEntry {
  symbol: string;
  exDate: string;
}

export interface PlannedAutoDividend {
  symbol: string;
  exDate: string;
  /** Cash date: paymentDate ?? exDate. Becomes transaction.tradeDate. */
  tradeDate: string;
  /** Shares held at ex-date (same <= semantics as computeRetroactiveIncome). */
  quantity: string;
  /** Gross amount per share in the dividend's native currency. */
  price: string;
  currency: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * How far a booked dividend sits from one provider payment: from the cash date,
 * or — when the booking is on or after it — from the ex-date.
 *
 * Brokers book a dividend near its ex-date while the provider's cash date is
 * ~3 weeks later; measuring from the cash date alone missed those bookings, and
 * the reconciler added the same payment a second time. A booking cannot
 * precede its ex-date, so the ex-date only counts from that day on — give or
 * take the few days providers disagree with brokers about it — which also stops
 * an early booking from claiming the next month's payment.
 *
 * The one definition of "the same payment": the reconciler, import adoption,
 * the in-flight filter and the supersede repair all use it.
 */
export function paymentDistance(
  bookedOn: string,
  payment: { exDate: string; cashDate: string },
): number {
  const fromCash = dayDistance(bookedOn, payment.cashDate);
  const fromEx = dayDistance(bookedOn, payment.exDate);
  return bookedOn >= payment.exDate || fromEx <= EX_DATE_SLACK_DAYS
    ? Math.min(fromCash, fromEx)
    : fromCash;
}

/** A provider's ex-date can sit up to a week after the one the broker used
 *  (a fund's own ex-date against its secondary listing's). */
const EX_DATE_SLACK_DAYS = 7;

/** One-to-one, order-preserving pairing of provider payments with booked
 *  dividends (pairs within `MATCH_WINDOW_DAYS` by `paymentDistance`): the most
 *  pairs, then the least total distance. Returns the indices of matched
 *  payments.
 *
 *  One-to-one is load-bearing for monthly payers — a single recorded payment
 *  must never satisfy two consecutive provider dividends. Order-preserving
 *  because bookings and payments both run in date order: a greedy
 *  nearest-first pass let May's booking, three days after April's cash date,
 *  claim April — stranding April's own ex-date booking and reporting May as
 *  unbooked, which the reconciler then added a second time. */
function matchedDividendIndices(
  payments: { exDate: string; cashDate: string }[],
  txDates: string[],
): Set<number> {
  const p = payments
    .map((pay, index) => ({ ...pay, index }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate) || a.index - b.index);
  const t = [...txDates].sort();
  const n = p.length;
  const m = t.length;
  // best[i][j]: optimal alignment of p[i..] with t[j..] — [pairs, -distance].
  const best: [number, number][][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => [0, 0] as [number, number]),
  );
  const better = (a: [number, number], b: [number, number]) =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let choice = best[i + 1]![j]!;
      if (better(best[i]![j + 1]!, choice)) choice = best[i]![j + 1]!;
      const dist = paymentDistance(t[j]!, p[i]!);
      if (dist <= MATCH_WINDOW_DAYS) {
        const next = best[i + 1]![j + 1]!;
        const take: [number, number] = [next[0] + 1, next[1] - dist];
        if (better(take, choice)) choice = take;
      }
      best[i]![j] = choice;
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const dist = paymentDistance(t[j]!, p[i]!);
    const next = best[i + 1]![j + 1]!;
    if (
      dist <= MATCH_WINDOW_DAYS &&
      best[i]![j]![0] === next[0] + 1 &&
      best[i]![j]![1] === next[1] - dist
    ) {
      matched.add(p[i]!.index);
      i++;
      j++;
    } else if (best[i]![j] === best[i + 1]![j]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

/**
 * Decide which provider dividends are missing from the transaction ledger.
 * Pure and deterministic: same inputs → same plan, sorted by symbol, exDate.
 *
 * A dividend is planned when ALL hold:
 *  - its cash date (paymentDate ?? exDate) is <= today (cash has landed),
 *  - shares held at ex-date > 0 (timeline semantics shared with
 *    computeRetroactiveIncome via buildSharesTimeline/sharesHeldOn),
 *  - its (symbol, exDate) is not in the auto-dividend ledger (live OR tombstone),
 *  - no existing dividend transaction pairs with it (one-to-one, ±10 days).
 */
export function planAutoDividends(input: {
  transactions: PositionTransaction[];
  dividends: DividendHistoryRow[];
  ledger: AutoDividendLedgerEntry[];
  today: string;
}): PlannedAutoDividend[] {
  const ledgerKeys = new Set(input.ledger.map((l) => `${l.symbol}|${l.exDate}`));

  const txsBySymbol = new Map<string, PositionTransaction[]>();
  for (const tx of input.transactions) {
    const list = txsBySymbol.get(tx.symbol) ?? [];
    list.push(tx);
    txsBySymbol.set(tx.symbol, list);
  }

  const divsBySymbol = new Map<string, DividendHistoryRow[]>();
  for (const d of input.dividends) {
    if (!txsBySymbol.has(d.symbol)) continue;
    const list = divsBySymbol.get(d.symbol) ?? [];
    list.push(d);
    divsBySymbol.set(d.symbol, list);
  }

  const plan: PlannedAutoDividend[] = [];

  for (const [symbol, divs] of divsBySymbol) {
    const txs = txsBySymbol.get(symbol)!;
    // Only cash that has landed participates — in-flight dividends are neither
    // planned nor allowed to consume a recorded transaction in matching.
    const payable = divs
      .map((d) => ({ d, cashDate: d.paymentDate ?? d.exDate }))
      .filter((x) => x.cashDate <= input.today)
      .sort((a, b) => a.d.exDate.localeCompare(b.d.exDate));
    if (payable.length === 0) continue;

    const divTxDates = txs.filter((t) => t.type === "dividend").map((t) => isoDay(t.tradeDate));
    const matched = matchedDividendIndices(
      payable.map((x) => ({ exDate: x.d.exDate, cashDate: x.cashDate })),
      divTxDates,
    );

    const timeline = buildSharesTimeline(txs);
    payable.forEach(({ d, cashDate }, i) => {
      if (matched.has(i)) return;
      if (ledgerKeys.has(`${d.symbol}|${d.exDate}`)) return;
      const held = sharesHeldOn(timeline, new Date(`${d.exDate}T00:00:00Z`));
      if (!held.greaterThan(0)) return;
      plan.push({
        symbol: d.symbol,
        exDate: d.exDate,
        tradeDate: cashDate,
        quantity: held.toFixed(),
        price: new Decimal(d.amountPerShare).toFixed(),
        currency: d.currency,
      });
    });
  }

  plan.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exDate.localeCompare(b.exDate));
  return plan;
}

/**
 * Filter synthetic in-flight dividend rows down to those that do NOT pair
 * with an existing received (ledger) payment for the same symbol.
 *
 * `received` keys on the LEDGER's cash date; `inFlight` keys on the
 * PROVIDER's payment date. When the ledger records cash a few days before
 * (or after) the provider's expected payment date — a broker crediting
 * early, an estimated payment date overshooting, a user recording the
 * payment on the ex-date — the same payment lands in BOTH series: once as
 * history, once as forward income. Reuses the exact ±10-day, one-to-one,
 * nearest-first matcher `planAutoDividends` already relies on to avoid
 * duplicate ledger rows, so both call sites agree on what counts as "the
 * same payment".
 */
export function excludeMatchedInFlight<
  T extends { symbol: string; exDate: string; paymentDate?: string | null },
>(inFlight: T[], received: { symbol: string; cashDate: string }[]): T[] {
  const receivedDatesBySymbol = new Map<string, string[]>();
  for (const r of received) {
    const list = receivedDatesBySymbol.get(r.symbol) ?? [];
    list.push(r.cashDate);
    receivedDatesBySymbol.set(r.symbol, list);
  }

  const inFlightBySymbol = new Map<string, { row: T; index: number }[]>();
  inFlight.forEach((row, index) => {
    const list = inFlightBySymbol.get(row.symbol) ?? [];
    list.push({ row, index });
    inFlightBySymbol.set(row.symbol, list);
  });

  const excluded = new Set<number>();
  for (const [symbol, entries] of inFlightBySymbol) {
    const receivedDates = receivedDatesBySymbol.get(symbol);
    if (!receivedDates || receivedDates.length === 0) continue;
    const payments = entries.map(({ row }) => ({
      exDate: row.exDate,
      cashDate: row.paymentDate ?? row.exDate,
    }));
    const matched = matchedDividendIndices(payments, receivedDates);
    entries.forEach(({ index }, i) => {
      if (matched.has(i)) excluded.add(index);
    });
  }

  return inFlight.filter((_, index) => !excluded.has(index));
}

/**
 * The auto-added dividends a broker booking already covers — the transaction
 * ids to remove.
 *
 * Before `paymentDistance` learned about ex-dates, the reconciler added a
 * second copy of every payment a broker had booked near its ex-date, and an
 * import could not adopt the copy either. Each such pair counted the payment
 * twice. Pairs provider payments with broker bookings one-to-one (the same
 * matcher the planner uses); an auto row whose payment a booking claimed is
 * superseded. Removing its transaction leaves the auto-dividend ledger row as a
 * tombstone, so the reconciler never adds it again.
 */
export function supersededAutoDividends(input: {
  dividends: DividendHistoryRow[];
  /** Dividend transactions NOT created by Sage: imported or entered by hand. */
  booked: { symbol: string; tradeDate: string }[];
  auto: { symbol: string; exDate: string; transactionId: string }[];
}): string[] {
  const out: string[] = [];
  for (const symbol of new Set(input.auto.map((a) => a.symbol))) {
    const bookedDates = input.booked.filter((b) => b.symbol === symbol).map((b) => b.tradeDate);
    if (bookedDates.length === 0) continue;
    const payments = input.dividends
      .filter((d) => d.symbol === symbol)
      .map((d) => ({ exDate: d.exDate, cashDate: d.paymentDate ?? d.exDate }));
    const matched = matchedDividendIndices(payments, bookedDates);
    const coveredExDates = new Set([...matched].map((i) => payments[i]!.exDate));
    for (const a of input.auto) {
      if (a.symbol === symbol && coveredExDates.has(a.exDate)) out.push(a.transactionId);
    }
  }
  return out;
}
