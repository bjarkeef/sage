import { rangeChange, valueAtOrBefore, type RangeChange, type SeriesPoint } from "./range-change";
import type { ChartModel } from "./model";

/** What the page knows about the requested comparison before the model does. */
export interface CompareContext {
  name: string;
  status: "pending" | "ready" | "unavailable";
  reason: string | null;
}

export interface CompareReadout extends CompareContext {
  youPct: number | null;
  benchmarkPct: number | null;
}

/** The header's line under the price. The single producer of every figure the
 *  chart puts into words. */
export interface ChartReadout {
  /** The hovered day's close; null when not scrubbing (the header shows the quote). */
  close: number | null;
  /** The hovered day; null means "the whole range, to today". */
  date: string | null;
  currency: string;
  rangePhrase: string;
  /** Price change from range start to `date` (or today). */
  price: RangeChange | null;
  /** Total-return change in percent, when the line is total return on the price axis. */
  totalReturnPct: number | null;
  compare: CompareReadout | null;
}

function at(points: SeriesPoint[], date: string | null): SeriesPoint | null {
  return date === null ? (points[points.length - 1] ?? null) : valueAtOrBefore(points, date);
}

export function readoutAt(
  model: ChartModel,
  date: string | null,
  ctx: { rangePhrase: string; currency: string; compare: CompareContext | null },
): ChartReadout {
  const prices = model.closes.map((c) => ({ time: c.date, value: c.close }));
  const hovered = date === null ? null : valueAtOrBefore(prices, date);
  const totalReturnPct =
    model.axis === "price" && model.lineMode === "tr" && model.totalReturn
      ? (rangeChange(model.totalReturn, date)?.pct ?? null)
      : null;

  let compare: CompareReadout | null = null;
  if (ctx.compare) {
    const drawn = model.axis === "percent" && model.benchmark !== null;
    const unavailable =
      ctx.compare.status === "unavailable" || (ctx.compare.status === "ready" && !drawn);
    const fallbackReason = model.trUnavailable
      ? `${ctx.compare.name} unavailable: ${model.trUnavailable}`
      : `${ctx.compare.name} unavailable`;
    compare = {
      name: ctx.compare.name,
      status: unavailable ? "unavailable" : ctx.compare.status,
      reason: unavailable ? (ctx.compare.reason ?? fallbackReason) : null,
      youPct: drawn ? (at(model.holding, date)?.value ?? null) : null,
      benchmarkPct: drawn && model.benchmark ? (at(model.benchmark, date)?.value ?? null) : null,
    };
  }

  return {
    close: hovered?.value ?? null,
    date: hovered ? date : null,
    currency: ctx.currency,
    rangePhrase: ctx.rangePhrase,
    price: rangeChange(prices, date),
    totalReturnPct,
    compare,
  };
}
