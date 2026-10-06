import {
  Decimal,
  clampDividendGrowth,
  projectDividendSchedule,
  projectionHorizonIso,
  longRangeThroughIso,
  type DividendHistoryRow,
  type ProjectedDividendRow,
} from "@sage/core";

export interface ForwardSchedule {
  /** Declared by the issuer; ex-date within the 12-month horizon. */
  announced: ProjectedDividendRow[];
  /** Modelled from history; ex-date within the 12-month horizon. */
  projected: ProjectedDividendRow[];
  /** Past the 12-month horizon, through 31 December three years out, grown by
   *  `growth`. Calendar-only: nothing that means "the next 12 months" sums it. */
  longRange: ProjectedDividendRow[];
}

/**
 * The growth a forward schedule applies to its long-range payments: the
 * historical CAGR clamped to the forward cap. The one place that rule lives;
 * the income view and the asset page both ask it, so they cannot grow the same
 * dividend by different rates. `cappedFrom` is the historical rate, set only
 * where the cap actually changed it, so a caller can say what it was capped
 * from.
 */
export function forwardGrowth(
  cagr: Decimal | null,
  allowNegative: boolean,
): { growth: Decimal | null; cappedFrom: Decimal | null } {
  if (!cagr) return { growth: null, cappedFrom: null };
  const growth = clampDividendGrowth(cagr, allowNegative);
  return { growth, cappedFrom: growth && cagr.greaterThan(growth) ? cagr : null };
}

/**
 * The forward dividend schedule for one market holding.
 *
 * The one producer of forward payments: the income view (overview, /dividends,
 * the tape) and the asset page's `upcoming` both call it, so "next 12 months"
 * cannot mean two different sets of payments on two pages. Custom holdings do
 * not come through here — they project from their own settings.
 *
 * Pure: `now` is an argument. `history` must already be deduped; rows for other
 * symbols are ignored.
 */
export function forwardScheduleForSymbol(input: {
  symbol: string;
  quantity: Decimal;
  history: DividendHistoryRow[];
  now: Date;
  growth: Decimal | null;
}): ForwardSchedule {
  const { symbol, quantity, now } = input;
  const todayIso = now.toISOString().slice(0, 10);
  const mine = input.history.filter((d) => d.symbol === symbol);
  const base = {
    symbol,
    quantity,
    history: mine.filter((d) => d.exDate <= todayIso),
    announced: mine
      .filter((d) => d.exDate > todayIso)
      .map((d) => ({
        exDate: d.exDate,
        paymentDate: d.paymentDate ?? null,
        paymentDateEstimated: d.paymentDateEstimated ?? false,
        amountPerShare: d.amountPerShare,
        currency: d.currency,
      })),
    asOf: now,
  };

  const twelve = projectDividendSchedule(base);
  const projectedThrough = projectionHorizonIso(now);
  const longRange = projectDividendSchedule({
    ...base,
    through: longRangeThroughIso(now),
    growth: input.growth ?? undefined,
  }).filter((r) => r.exDate > projectedThrough);

  return {
    announced: twelve.filter((r) => r.kind === "announced"),
    projected: twelve.filter((r) => r.kind === "projected"),
    longRange,
  };
}

export interface AssetUpcomingRow {
  exDate: string;
  paymentDate: string | null;
  /** Per share, gross, in the payment's own currency. */
  amountPerShare: string;
  currency: string;
  /** Declared (announced, or ex-date passed with cash pending) vs modelled. */
  certainty: "confirmed" | "estimated";
  /** "next12m" is exactly what the overview's next-12-months figure sums;
   *  "longRange" only feeds the forecast-year bar. */
  window: "next12m" | "longRange";
}

/**
 * The asset page's `upcoming`: one symbol's schedule plus its payments in
 * flight, per share, sorted by cash date (payment date, else ex-date — the rule
 * the tape and /dividends use).
 *
 * In flight = ex-date on or before today, payment date after it. The income view
 * counts those in its next 12 months, so this does too; their amount is declared,
 * hence "confirmed". `history` must be this symbol's deduped rows.
 */
export function toAssetUpcoming(input: {
  schedule: ForwardSchedule;
  history: DividendHistoryRow[];
  todayIso: string;
}): AssetUpcomingRow[] {
  const fromSchedule = (
    r: ProjectedDividendRow,
    window: AssetUpcomingRow["window"],
  ): AssetUpcomingRow => ({
    exDate: r.exDate,
    paymentDate: r.paymentDate,
    amountPerShare: r.amountPerShare,
    currency: r.currency,
    certainty: r.kind === "announced" ? "confirmed" : "estimated",
    window,
  });

  const inFlight: AssetUpcomingRow[] = input.history
    .filter(
      (d) => d.exDate <= input.todayIso && d.paymentDate != null && d.paymentDate > input.todayIso,
    )
    .map((d) => ({
      exDate: d.exDate,
      paymentDate: d.paymentDate ?? null,
      amountPerShare: d.amountPerShare,
      currency: d.currency,
      certainty: "confirmed",
      window: "next12m",
    }));

  return [
    ...inFlight,
    ...input.schedule.announced.map((r) => fromSchedule(r, "next12m")),
    ...input.schedule.projected.map((r) => fromSchedule(r, "next12m")),
    ...input.schedule.longRange.map((r) => fromSchedule(r, "longRange")),
  ].sort((a, b) => (a.paymentDate ?? a.exDate).localeCompare(b.paymentDate ?? b.exDate));
}
