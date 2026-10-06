import type { ClosePoint, SeriesPoint } from "./range-change";

export interface DividendEvent {
  exDate: string;
  /** Per share, in the closes' currency. */
  amount: number;
}

/**
 * The price line as if every dividend were reinvested at its ex-date close:
 *   tr[0] = close[0];  tr[i] = tr[i−1] × (close[i] + div[i]) / close[i−1]
 * where div[i] is the dividend whose ex-date is bar i. Computed in the
 * equivalent form tr[i] = close[i] × F[i], F[i] = F[i−1] × (1 + div[i] / close[i]),
 * F[0] = 1 — so with no dividends F stays exactly 1 and the line IS the price
 * line, to the last bit (consistency check: spec Data reliability 3). Starting
 * at close[0] keeps it on the price axis.
 *
 * A dividend whose ex-date has no bar (weekend, holiday) lands on the first bar
 * after it. One on or before the first bar is outside the range — there is no
 * earlier close to reinvest from — and so is one after the last bar.
 */
export function totalReturnSeries(closes: ClosePoint[], dividends: DividendEvent[]): SeriesPoint[] {
  if (closes.length === 0) return [];
  const first = closes[0]!.date;
  const divByIndex = new Map<number, number>();
  for (const d of dividends) {
    if (d.exDate <= first) continue;
    const i = closes.findIndex((c) => c.date >= d.exDate);
    if (i <= 0) continue;
    divByIndex.set(i, (divByIndex.get(i) ?? 0) + d.amount);
  }

  let factor = 1;
  return closes.map((c, i) => {
    const div = divByIndex.get(i);
    if (div !== undefined && c.close > 0) factor *= 1 + div / c.close;
    return { time: c.date, value: factor === 1 ? c.close : c.close * factor };
  });
}
