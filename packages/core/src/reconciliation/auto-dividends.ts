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

/** One-to-one nearest-first pairing: every (dividend, transaction) pair within
 *  the window is ranked by date distance; greedily take pairs whose sides are
 *  both still free. Returns the indices of matched dividends. One-to-one is
 *  load-bearing for monthly payers — a single recorded payment must never
 *  satisfy two consecutive provider dividends (~30 days apart). */
function matchedDividendIndices(cashDates: string[], txDates: string[]): Set<number> {
  const pairs: { div: number; tx: number; dist: number }[] = [];
  for (let i = 0; i < cashDates.length; i++) {
    for (let j = 0; j < txDates.length; j++) {
      const dist = dayDistance(cashDates[i]!, txDates[j]!);
      if (dist <= MATCH_WINDOW_DAYS) pairs.push({ div: i, tx: j, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist || a.div - b.div || a.tx - b.tx);
  const matchedDivs = new Set<number>();
  const usedTxs = new Set<number>();
  for (const p of pairs) {
    if (matchedDivs.has(p.div) || usedTxs.has(p.tx)) continue;
    matchedDivs.add(p.div);
    usedTxs.add(p.tx);
  }
  return matchedDivs;
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
      payable.map((x) => x.cashDate),
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
    const cashDates = entries.map(({ row }) => row.paymentDate ?? row.exDate);
    const matched = matchedDividendIndices(cashDates, receivedDates);
    entries.forEach(({ index }, i) => {
      if (matched.has(i)) excluded.add(index);
    });
  }

  return inFlight.filter((_, index) => !excluded.has(index));
}
