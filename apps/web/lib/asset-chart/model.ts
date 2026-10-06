import {
  direction,
  rangeChange,
  type ClosePoint,
  type Direction,
  type SeriesPoint,
} from "./range-change";
import { totalReturnSeries } from "./total-return";
import { rebasePair } from "./rebase";

export type ChartMode = "price" | "tr";

/** A dividend as the asset endpoint lists it (`dividends.history`). */
export interface ChartDividend {
  exDate: string;
  amountPerShare: string;
  currency: string;
  paymentDate: string | null;
}

export interface ChartModel {
  /** "percent" only while a benchmark is drawn. */
  axis: "price" | "percent";
  /** What the holding's line shows. A comparison forces "tr". */
  lineMode: ChartMode;
  holding: SeriesPoint[];
  benchmark: SeriesPoint[] | null;
  closes: ClosePoint[];
  /** Total return on the price axis, or null when it cannot be drawn. */
  totalReturn: SeriesPoint[] | null;
  /** Why total return cannot be drawn (lower-case clause), or null. */
  trUnavailable: string | null;
  /** Dividends with an ex-date inside the range, ascending — the markers. */
  dividendsInRange: {
    exDate: string;
    amountPerShare: number;
    currency: string;
    paymentDate: string | null;
  }[];
  direction: Direction;
}

/** Change of a percent line that starts at 0: its last value is the change. */
function drawnChange(percentLine: SeriesPoint[]) {
  const v = percentLine[percentLine.length - 1]?.value;
  return v === undefined ? null : { abs: v, pct: v };
}

/**
 * Everything the chart draws, decided in one place.
 *
 * Total return is computed from the closes and the page's own
 * `dividends.history`, so it cannot disagree with the payments list. When a
 * dividend in range is in another currency than the closes it cannot be drawn
 * (the page converts nothing) and the model says why.
 *
 * A benchmark is always total return, so the holding is too whenever one is
 * drawn: a price line against a TR index is the bias Sage removed from
 * /performance. No total return means no comparison.
 */
export function buildChartModel(input: {
  closes: ClosePoint[];
  currency: string;
  dividends: ChartDividend[];
  mode: ChartMode;
  benchmark: { name: string; bars: ClosePoint[] } | null;
}): ChartModel {
  const { closes, currency } = input;
  const first = closes[0]?.date;
  const last = closes[closes.length - 1]?.date;
  const dividendsInRange =
    first && last
      ? input.dividends
          .filter((d) => d.exDate >= first && d.exDate <= last)
          .map((d) => ({
            exDate: d.exDate,
            amountPerShare: Number(d.amountPerShare),
            currency: d.currency,
            paymentDate: d.paymentDate,
          }))
          .sort((a, b) => a.exDate.localeCompare(b.exDate))
      : [];

  const foreign = dividendsInRange.find((d) => d.currency !== currency);
  const trUnavailable = foreign
    ? `dividends are paid in ${foreign.currency} and prices quoted in ${currency}, so total return can't be drawn`
    : null;
  const priceLine = closes.map((c) => ({ time: c.date, value: c.close }));
  const totalReturn = trUnavailable
    ? null
    : totalReturnSeries(
        closes,
        dividendsInRange.map((d) => ({ exDate: d.exDate, amount: d.amountPerShare })),
      );
  const base = { closes, totalReturn, trUnavailable, dividendsInRange };

  if (input.benchmark && totalReturn) {
    const pair = rebasePair(totalReturn, input.benchmark.bars);
    if (pair) {
      return {
        ...base,
        axis: "percent",
        lineMode: "tr",
        holding: pair.holding,
        benchmark: pair.benchmark,
        // From the drawn line: it starts where the benchmark does, not at the
        // holding's first bar, and its first value is 0 (so rangeChange is null).
        direction: direction(drawnChange(pair.holding)),
      };
    }
  }

  const lineMode: ChartMode = input.mode === "tr" && totalReturn ? "tr" : "price";
  const holding = lineMode === "tr" && totalReturn ? totalReturn : priceLine;
  return {
    ...base,
    axis: "price",
    lineMode,
    holding,
    benchmark: null,
    direction: direction(rangeChange(holding)),
  };
}
