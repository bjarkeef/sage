import { Decimal } from "@sage/core";
import type { PortfolioViewDeps } from "./portfolio-view";
import { buildValuationSeries, fetchBenchmarkSeries } from "./valuation-series";
import type { PortfolioBook } from "./portfolio-book";

/**
 * The portfolio value/cost chart: a serialised {@link buildValuationSeries},
 * its change over the window, and any requested benchmark series.
 */
export async function buildPortfolioHistoryView(
  deps: PortfolioViewDeps,
  userId: string,
  opts: { range?: string; currency?: string | null; benchmarks?: string[]; book?: PortfolioBook },
) {
  const series = await buildValuationSeries(deps, userId, {
    range: opts.range,
    currency: opts.currency,
    book: opts.book,
  });

  if ("empty" in series) {
    return {
      points: [],
      changePercent: 0,
      changeAmount: { amount: "0", currency: series.targetCurrency },
      fxApproximated: false,
      fxIncomplete: false,
      fxStale: false,
      fxRatesAsOf: null,
      stalePrices: [],
    };
  }

  const points = series.points.map((p) => ({
    date: p.date,
    value: { amount: p.marketValue.toFixed(2), currency: series.targetCurrency },
    invested: { amount: p.invested.toFixed(2), currency: series.targetCurrency },
  }));

  const first = points[0];
  const last = points[points.length - 1];
  let changePercent = 0;
  let changeAmount = { amount: "0", currency: series.targetCurrency };
  if (first && last) {
    const diff = new Decimal(last.value.amount).minus(new Decimal(first.value.amount));
    changeAmount = { amount: diff.toFixed(2), currency: series.targetCurrency };
    const firstVal = new Decimal(first.value.amount);
    if (!firstVal.isZero()) {
      changePercent = Number(diff.dividedBy(firstVal).times(100).toFixed(2));
    }
  }

  const benchmarkIds = opts.benchmarks ?? [];
  const benchmarkData: {
    symbol: string;
    name: string;
    points: { date: string; percentChange: number }[];
  }[] = [];
  if (benchmarkIds.length > 0) {
    const fetched = await fetchBenchmarkSeries(
      deps.provider,
      benchmarkIds,
      series.clampedFrom,
      series.to,
    );
    for (const bm of fetched) {
      const firstClose = bm.bars[0]!.close;
      benchmarkData.push({
        symbol: bm.id,
        name: bm.name,
        points: bm.bars.map((bar) => ({
          date: bar.date,
          percentChange: Number(
            bar.close.minus(firstClose).dividedBy(firstClose).times(100).toFixed(2),
          ),
        })),
      });
    }
  }

  return {
    points,
    changePercent,
    changeAmount,
    // Holdings valued from a close older than STALE_PRICE_DAYS. They are in the
    // total at that price, so the chart is drawn but the figure is older than
    // it looks — the client says so rather than letting a flat line pass for a
    // quiet market.
    stalePrices: series.stalePrices,
    benchmarks: benchmarkData,
    // At least one date could not be priced from the stored ECB series and fell
    // back to today's rate; the client labels the chart rather than passing an
    // approximation off as history.
    fxApproximated: series.fxApproximated,
    // A currency ECB does not publish at all: the holding is missing from these
    // points entirely, so the chart reads low. Saying so is the whole
    // difference between "degraded" and "silently wrong".
    fxIncomplete: series.fxIncomplete,
    // The rates that priced this chart are more than a week old.
    fxStale: series.fxStale,
    fxRatesAsOf: series.fxRatesAsOf,
  };
}
