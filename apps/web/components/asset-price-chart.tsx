"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  AreaSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { SegmentedControl, ChartSkeleton, Button } from "@sage/ui";
import { getAssetChart } from "../lib/api";
import { qk } from "../lib/query/keys";
import { formatDate } from "../lib/format";
import type { AssetPositionDTO } from "../lib/types";
import {
  readChartTheme,
  baseChartOptions,
  areaSeriesOptions,
  attachHoverTooltip,
} from "../lib/chart-config";

type Trade = NonNullable<AssetPositionDTO["trades"]>[number];

/** Buy/sell dots sit on the price line (`inBar`); color carries direction, and
 *  the id lets the hover tooltip resolve which trade it is. */
function tradeMarkers(trades: Trade[], theme: { primary: string; loss: string }) {
  return trades.map((t, i) => ({
    time: t.tradeDate,
    position: "inBar" as const,
    color: t.type === "buy" ? theme.primary : theme.loss,
    shape: "circle" as const,
    id: `trade-${i}`,
  }));
}

const RANGES = [
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "YTD", value: "YTD" },
  { label: "1Y", value: "1Y" },
  { label: "All", value: "ALL" },
];

const INITIAL_RANGE = "1Y";

interface AssetPriceChartProps {
  slug: string;
  initialChart: { date: string; close: { amount: string; currency: string } }[];
  position: AssetPositionDTO;
}

export function AssetPriceChart({ slug, initialChart, position }: AssetPriceChartProps) {
  const [range, setRange] = React.useState(INITIAL_RANGE);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Area"> | null>(null);
  const { resolvedTheme } = useTheme();

  const trades = React.useMemo(() => position.trades ?? [], [position.trades]);
  const [showTrades, setShowTrades] = React.useState(trades.length <= 15);
  const markersRef = React.useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.assetChart(slug, range),
    queryFn: () => getAssetChart(slug, range),
    staleTime: 300_000,
    initialData: range === INITIAL_RANGE ? initialChart : undefined,
  });
  const rawChart = React.useMemo(() => data ?? [], [data]);

  const chartData = React.useMemo(
    () => rawChart.map((p) => ({ time: p.date, value: Number(p.close.amount) })),
    [rawChart],
  );

  React.useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;

    const theme = readChartTheme();

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(
      containerRef.current,
      baseChartOptions(theme, containerRef.current.clientWidth, 240, range === "1W"),
    );

    const series = chart.addSeries(AreaSeries, areaSeriesOptions(theme));
    series.setData(chartData);

    const currency = rawChart[0]?.close.currency ?? "USD";
    const formatValue = (v: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(v);

    if (position.held && position.averageCost) {
      series.createPriceLine({
        price: Number(position.averageCost.amount),
        color: theme.costLine,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `Avg cost ${formatValue(Number(position.averageCost.amount))}`,
      });
    }

    const markerPrimitive = createSeriesMarkers(
      series,
      showTrades ? tradeMarkers(trades, theme) : [],
    );
    markersRef.current = markerPrimitive;

    chart.timeScale().fitContent();

    const resolveMarker = (id: unknown) => {
      const t = typeof id === "string" ? trades[Number(id.slice("trade-".length))] : undefined;
      if (!t) return null;
      return {
        primary: t.type === "buy" ? "Buy" : "Sell",
        secondary: `${Number(t.quantity)} sh · ${formatValue(Number(t.price))} · ${formatDate(t.tradeDate)}`,
        colorClass: t.type === "buy" ? "text-primary" : "text-loss",
      };
    };

    const detachTooltip = attachHoverTooltip(
      chart,
      series,
      containerRef.current,
      formatValue,
      resolveMarker,
    );

    chartRef.current = chart;
    seriesRef.current = series;

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
      seriesRef.current = null;
    };
    // showTrades is driven by the markers effect below; rawChart is a ref-stable
    // callback — including either would tear down and rebuild the whole chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, resolvedTheme, position.held, position.averageCost, trades]);

  React.useEffect(() => {
    if (!markersRef.current) return;
    const theme = readChartTheme();
    markersRef.current.setMarkers(showTrades ? tradeMarkers(trades, theme) : []);
  }, [showTrades, trades]);

  if (isLoading) return <ChartSkeleton />;
  if (chartData.length === 0) {
    return <p className="text-sm text-muted-foreground">No price data available for this range.</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="relative h-60" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" />
        {trades.length > 0 && (
          <div className="flex items-center gap-3">
            {showTrades && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary" /> Buy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-loss" /> Sell
                </span>
              </div>
            )}
            <Button
              variant={showTrades ? "default" : "outline"}
              size="sm"
              onClick={() => setShowTrades((v) => !v)}
            >
              Trades
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
