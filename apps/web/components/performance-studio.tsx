"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createChart, AreaSeries, LineSeries, type IChartApi } from "lightweight-charts";
import { useTheme } from "next-themes";
import { SegmentedControl } from "@sage/ui";
import { getPerformance } from "../lib/api";
import { formatMoney } from "../lib/format";
import { qk } from "../lib/query/keys";
import { HeroSkeleton } from "./skeletons";
import {
  readChartTheme,
  baseChartOptions,
  areaSeriesOptions,
  comparisonSeriesOptions,
  attachHoverTooltip,
} from "../lib/chart-config";
import { PerformanceEmptyState, formatRate } from "./performance-stats";
import { PerfMetrics } from "./performance-metrics";
import { FxApproximatedCallout } from "./fx-approximated-callout";
import { FxStaleCallout } from "./fx-stale-callout";
import { FxUnavailableCallout } from "./fx-unavailable-callout";
import { BasisMismatchCallout } from "./basis-mismatch-callout";

const RANGES = [
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "YTD", value: "YTD" },
  { label: "1Y", value: "1Y" },
  { label: "All", value: "ALL" },
];

const RANGE_LABEL: Record<string, string> = {
  "1M": "month",
  "3M": "3 months",
  YTD: "year to date",
  "1Y": "year",
  ALL: "since inception",
};

const BENCHMARK_COLORS = ["var(--chart-comparison-1)", "var(--chart-comparison-2)"];

/** Growth-index values are multipliers off 1.0 (e.g. 1.0432 = +4.32%); the
 *  whole chart — portfolio and benchmarks alike — renders in percent. */
function toPercentPoints(points: { date: string; value: number }[]) {
  return points.map((p) => ({ time: p.date, value: (p.value - 1) * 100 }));
}

export function PerformanceStudio() {
  const [range, setRange] = React.useState("1Y");
  const { data, isLoading } = useQuery({
    queryKey: qk.performance(range),
    queryFn: () => getPerformance(range),
    staleTime: 300_000,
  });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  const chartData = React.useMemo(() => (data ? toPercentPoints(data.indexSeries) : []), [data]);

  const benchmarkSeries = React.useMemo(
    () =>
      (data?.benchmarks ?? []).map((bm) => ({
        id: bm.id,
        points: toPercentPoints(bm.points),
      })),
    [data],
  );

  React.useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;

    const theme = readChartTheme();

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(
      containerRef.current,
      baseChartOptions(theme, containerRef.current.clientWidth, 240),
    );

    const series = chart.addSeries(AreaSeries, areaSeriesOptions(theme));
    series.setData(chartData);

    benchmarkSeries.forEach((bm, i) => {
      const bmSeries = chart.addSeries(
        LineSeries,
        comparisonSeriesOptions(theme, (i % 2) as 0 | 1),
      );
      bmSeries.setData(bm.points);
    });

    chart.timeScale().fitContent();

    const detachTooltip = attachHoverTooltip(
      chart,
      series,
      containerRef.current,
      (v) => `${v.toFixed(1)}%`,
    );

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width } = entries[0]!.contentRect;
      chart.applyOptions({ width });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      detachTooltip();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartData, benchmarkSeries, resolvedTheme]);

  if (isLoading) return <HeroSkeleton />;
  if (!data || data.insufficientData) return <PerformanceEmptyState />;

  const rangeLabel = RANGE_LABEL[range] ?? range;
  const twrTone = data.twr == null ? "" : data.twr >= 0 ? "text-gain" : "text-loss";

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span className="label-caps text-muted-foreground">Time-weighted return</span>
          <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" />
        </div>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className={`hero-num ${twrTone}`}>{formatRate(data.twr)}</div>
            {/* The money beside the rate, because this page reported only a
                percentage and the overview reported only an amount, and there
                was nowhere to see both. NOT inside the percentage's own
                parentheses: a time-weighted return removes your deposits, so no
                amount corresponds to it. This is what the book made over the
                same window with deposits netted out — the figure the overview's
                range cell prints, so the two pages agree on the pair and differ
                only in which half they lead with. */}
            {data.gain && (
              <span className="text-sm text-muted-foreground">{formatMoney(data.gain)} earned</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {range === "ALL" ? "since inception" : `past ${rangeLabel}`}
            {data.twrAnnualized != null && `, ${formatRate(data.twrAnnualized)} annualized`}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div ref={containerRef} className="relative h-60" />
        <div className="flex items-center gap-4 text-xs">
          {/* The swatch carries the line's own treatment: a solid bar for the
              portfolio's area series, a dash for the benchmarks' dashed lines.
              Round dots said nothing about either, which is what made two
              similar grey lines hard to tell apart. Same grammar as
              portfolio-chart.tsx. */}
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-muted-foreground">
            <span
              data-testid="legend-swatch-you"
              className="h-0.5 w-4 flex-none"
              style={{ background: "var(--chart-line)" }}
            />
            You
          </div>
          {data.benchmarks.map((bm, i) => (
            <div
              key={bm.id}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-muted-foreground"
            >
              <span
                data-testid={`legend-swatch-${bm.id}`}
                className="h-0.5 w-4 flex-none"
                style={{
                  background: `repeating-linear-gradient(to right, ${BENCHMARK_COLORS[i % 2]} 0 3px, transparent 3px 6px)`,
                }}
              />
              {bm.name}
            </div>
          ))}
        </div>
      </div>

      {/* Above the figures rather than below with the FX banners: this one says
          the numbers immediately following it may be wrong, and a reader
          scanning the bento would never reach a footnote. Renders nothing on a
          clean book, so it costs no space in the common case. */}
      <BasisMismatchCallout
        findings={data.basisMismatches}
        unverifiedSplits={data.unverifiedSplits}
        historyIncomplete={data.historyIncomplete}
        splitSymbols={data.splitSymbols ?? []}
      />

      <PerfMetrics data={data} />

      {data.fxIncomplete && (
        <FxUnavailableCallout>
          Exchange rates are unavailable for one of the currencies in this portfolio, so those
          trades are left out of these return figures entirely.
        </FxUnavailableCallout>
      )}
      {data.fxApproximated && <FxApproximatedCallout />}
      {data.fxStale && <FxStaleCallout asOf={data.fxRatesAsOf} />}

      {data.anomalousDays > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.anomalousDays} day(s) excluded — price data anomalies
        </p>
      )}
    </div>
  );
}
