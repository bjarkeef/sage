"use client";

import * as React from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { createChart, AreaSeries, LineSeries, LineStyle, type IChartApi } from "lightweight-charts";
import { useTheme } from "next-themes";
import { SegmentedControl, Delta } from "@sage/ui";
import { getPortfolioHistory } from "../lib/api";
import { qk } from "../lib/query/keys";
import { moneyToNumber } from "../lib/format";
import { AmbientChartSkeleton, HeroSkeleton } from "./skeletons";
import { FxApproximatedCallout } from "./fx-approximated-callout";
import { FxStaleCallout } from "./fx-stale-callout";
import { FxUnavailableCallout } from "./fx-unavailable-callout";
import {
  readChartTheme,
  baseChartOptions,
  areaSeriesOptions,
  comparisonSeriesOptions,
  attachHoverTooltip,
} from "../lib/chart-config";
import type { DashboardDTO, PortfolioHistoryDTO } from "../lib/types";

const RANGES = [
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "YTD", value: "YTD" },
  { label: "1Y", value: "1Y" },
  { label: "All", value: "ALL" },
];

const RANGE_LABEL: Record<string, string> = {
  "1W": "week",
  "1M": "month",
  "3M": "3 months",
  YTD: "year to date",
  "1Y": "year",
  ALL: "since inception",
};

const INITIAL_RANGE = "1Y";

const COMPARISON_INDEX: Record<string, 0 | 1> = { sp500: 0, "msci-world": 1 };

const BENCHMARKS = [
  { key: "sp500", label: "S&P 500", cssVar: "var(--chart-comparison-1)" },
  { key: "msci-world", label: "MSCI World", cssVar: "var(--chart-comparison-2)" },
];

/** Apply an alpha to a resolved CSS color. Theme tokens resolve to either hex
 *  or rgb()/rgba() strings, so handle both (a bare hex-suffix on an rgba string
 *  is invalid CSS and canvas silently ignores it). */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const hexAlpha = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${hexAlpha}`;
  }
  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const [r, g, b] = match[1]!.split(",").map((part) => part.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export interface PortfolioChartProps {
  initialHistory: PortfolioHistoryDTO;
  displayCurrency: string | null;
  todayChange: DashboardDTO["todayChange"];
  /** "ambient" drops the chart's own hero header and price axis: the Wealth
   *  room already shows the net-worth number, so the chart is just atmosphere. */
  variant?: "default" | "ambient";
}

export function PortfolioChart({
  initialHistory,
  displayCurrency,
  todayChange,
  variant = "default",
}: PortfolioChartProps) {
  const ambient = variant === "ambient";
  const [range, setRange] = React.useState(INITIAL_RANGE);
  const [showInvested, setShowInvested] = React.useState(true);
  const [showBenchmarks, setShowBenchmarks] = React.useState<Record<string, boolean>>({
    sp500: false,
    "msci-world": false,
  });
  // The server-rendered initialHistory was fetched with whatever displayCurrency
  // this component first mounted with; capture it once so a later currency
  // change (a new prop value, same mounted instance) doesn't keep seeding stale
  // initialData forever -- it only seeds the exact key the server prefetched.
  const initialCurrencyRef = React.useRef(displayCurrency ?? undefined);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  const activeBenchmarks = React.useMemo(
    () =>
      Object.entries(showBenchmarks)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [showBenchmarks],
  );

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: qk.portfolioHistory(range, displayCurrency ?? undefined, activeBenchmarks),
    queryFn: () => getPortfolioHistory(range, displayCurrency ?? undefined, activeBenchmarks),
    staleTime: 300_000,
    // Keep the previous range's chart on screen while a new range fetches, so
    // switching timelines never collapses the block into a skeleton (no CLS,
    // and the range control stays put). isLoading is then true only on the
    // genuine first load with no seeded/cached data.
    placeholderData: keepPreviousData,
    initialData:
      range === INITIAL_RANGE &&
      (displayCurrency ?? undefined) === initialCurrencyRef.current &&
      activeBenchmarks.length === 0
        ? initialHistory
        : undefined,
  });

  const chartData = React.useMemo(
    () => data?.points.map((p) => ({ time: p.date, value: Number(p.value.amount) })) ?? [],
    [data],
  );

  const investedData = React.useMemo(
    () => data?.points.map((p) => ({ time: p.date, value: Number(p.invested.amount) })) ?? [],
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
      baseChartOptions(
        theme,
        containerRef.current.clientWidth,
        ambient ? 200 : 240,
        range === "1W",
      ),
    );
    if (ambient) {
      chart.priceScale("right").applyOptions({ visible: false });
    }

    const series = chart.addSeries(AreaSeries, areaSeriesOptions(theme));
    series.setData(chartData);

    if (showInvested && investedData.length > 0) {
      const investedSeries = chart.addSeries(LineSeries, {
        color: withAlpha(theme.text, 0.55),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      investedSeries.setData(investedData);
    }

    if (data?.benchmarks && data.benchmarks.length > 0) {
      for (const bm of data.benchmarks) {
        const bmSeries = chart.addSeries(LineSeries, {
          ...comparisonSeriesOptions(theme, COMPARISON_INDEX[bm.symbol] ?? 0),
          priceScaleId: "benchmark",
        });
        bmSeries.setData(bm.points.map((p) => ({ time: p.date, value: p.percentChange })));
      }
    }

    chart.timeScale().fitContent();

    const detachTooltip = attachHoverTooltip(chart, series, containerRef.current, (v) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: data?.points[0]?.value.currency ?? "USD",
        maximumFractionDigits: 0,
      }).format(v),
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
    // data?.points is already captured via chartData (derived from it); adding it
    // would rebuild the chart on every refetch that produced identical points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, investedData, showInvested, resolvedTheme, data?.benchmarks, ambient]);

  if (isLoading) return ambient ? <AmbientChartSkeleton /> : <HeroSkeleton />;
  if (!data || data.points.length === 0) {
    return <p className="text-muted-foreground text-sm">Not enough data for a chart yet.</p>;
  }

  const lastPoint = data.points[data.points.length - 1]!;
  const rangeLabel = RANGE_LABEL[range] ?? range;

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-4 ${ambient ? "justify-end" : "justify-between"}`}>
        {!ambient && <span className="label-caps text-muted-foreground">Net worth</span>}
        <SegmentedControl
          options={RANGES}
          value={range}
          onChange={setRange}
          size="sm"
          className={ambient ? "opacity-60 transition-opacity hover:opacity-100" : undefined}
        />
      </div>

      {!ambient && (
        <div>
          <HeroMoney money={lastPoint.value} />
          {todayChange && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Delta
                variant="chip"
                value={moneyToNumber(todayChange.amount)}
                percent={todayChange.percent}
                currency={todayChange.amount.currency}
              />
              <span className="text-xs text-muted-foreground">today</span>
            </div>
          )}
          {data.points.length >= 2 && (
            <p className="mt-1 text-xs text-muted-foreground">
              <Delta
                value={moneyToNumber(data.changeAmount)}
                percent={data.changePercent}
                currency={data.changeAmount.currency}
              />{" "}
              {range === "ALL" ? "since inception" : `past ${rangeLabel}`}
            </p>
          )}
        </div>
      )}

      {/* Fixed-height wrapper so the placeholder-data dim (a compositor-only
          opacity change) signals "loading a new range" without any layout shift. */}
      <div className={`relative ${ambient ? "h-50" : "h-60"}`}>
        <div
          ref={containerRef}
          className={`relative h-full w-full transition-opacity duration-200 ${
            isPlaceholderData ? "opacity-40" : ""
          }`}
        />
        {isPlaceholderData && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="label-caps text-muted-foreground">Updating…</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => setShowInvested((v) => !v)}
          // "Money in", not "Invested". The line is contributions minus
          // withdrawals — the same series the return figures net their flows
          // against — which sits BELOW the cost of the current holdings once
          // anything has been sold at a profit, because those gains were
          // reinvested. Trackers that plot cost-of-current-holdings instead
          // count recycled profit as money the user put in; this does not, and
          // the label has to say which of the two it is.
          title="Contributions minus withdrawals. Sits below the cost of your current holdings once you have sold at a profit, because those gains were reinvested."
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
            showInvested
              ? "bg-surface-hover text-foreground"
              : "text-muted-foreground opacity-60 hover:opacity-100"
          }`}
        >
          <span
            data-series-swatch
            className="h-0.5 w-4 flex-none"
            style={{
              background:
                "repeating-linear-gradient(to right, var(--muted-foreground) 0 3px, transparent 3px 6px)",
            }}
          />
          Money in
        </button>
        {BENCHMARKS.map(({ key, label, cssVar }) => {
          const active = showBenchmarks[key] ?? false;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setShowBenchmarks((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "bg-surface-hover text-foreground"
                  : "text-muted-foreground opacity-60 hover:opacity-100"
              }`}
            >
              <span
                data-series-swatch
                className="h-0.5 w-4 flex-none"
                style={{
                  background: `repeating-linear-gradient(to right, ${cssVar} 0 3px, transparent 3px 6px)`,
                }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {data.fxIncomplete && (
        <FxUnavailableCallout>
          Exchange rates are unavailable for one of the currencies in this portfolio, so those
          holdings are left out of this chart entirely — both the value and the cost line read low.
        </FxUnavailableCallout>
      )}
      {data.fxApproximated && <FxApproximatedCallout />}
      {data.fxStale && <FxStaleCallout asOf={data.fxRatesAsOf} />}
    </div>
  );
}

/** Hero numeral: big light-weight digits, currency unit stepped down and muted. */
function HeroMoney({ money }: { money: { amount: string; currency: string } }) {
  const parts = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Number(money.amount));
  return (
    <div className="hero-num">
      {parts.map((part, i) =>
        part.type === "currency" ? (
          <span key={i} className="text-xl font-normal text-muted-foreground">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </div>
  );
}
