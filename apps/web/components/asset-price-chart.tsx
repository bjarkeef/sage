"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  AreaSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type MouseEventParams,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import {
  SegmentedControl,
  ChartSkeleton,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@sage/ui";
import { getAssetChart, getBenchmarks, getBenchmarkSeries } from "../lib/api";
import { qk } from "../lib/query/keys";
import { formatDate } from "../lib/format";
import type {
  AssetDividendsDTO,
  AssetPositionDTO,
  BenchmarkOptionDTO,
  MoneyDTO,
} from "../lib/types";
import { TradeMarkers, type TradeMark } from "./trade-markers";
import { DividendMarkers, type DividendMark } from "./dividend-markers";
import { EasedCrosshair } from "./charts/eased-crosshair";
import {
  readChartTheme,
  baseChartOptions,
  areaSeriesOptions,
  benchmarkSeriesOptions,
  attachHoverTooltip,
  lineColorFor,
  withChartAlpha,
  type MarkerTip,
} from "../lib/chart-config";
import { buildChartModel, type ChartMode } from "../lib/asset-chart/model";
import { readoutAt, type ChartReadout, type CompareContext } from "../lib/asset-chart/readout";
import { RANGE_PHRASE, type RangeKey } from "../lib/asset-chart/range-change";
import { formatPerShare } from "../lib/asset-page/labels";

type Trade = NonNullable<AssetPositionDTO["trades"]>[number];

/** Series-time + direction for each trade; the primitive turns these into
 *  triangles on the line. `id` is what the hover label resolves back. */
function tradeMarks(trades: Trade[]): TradeMark[] {
  return trades.map((t, i) => ({
    time: t.tradeDate,
    direction: t.type === "buy" ? ("buy" as const) : ("sell" as const),
    id: `trade-${i}`,
  }));
}

const RANGES: { label: string; value: RangeKey }[] = [
  { label: "1W", value: "1W" },
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "YTD", value: "YTD" },
  { label: "1Y", value: "1Y" },
  { label: "All", value: "ALL" },
];

const MODES = [
  { label: "Price", value: "price" },
  { label: "Total return", value: "tr" },
];

/** "S&P 500 (TR), in EUR": the index's own name from the API, and the currency
 *  the server converted it into — the holding's (spec decision 2). */
function benchmarkLabel(name: string, currency: string): string {
  return `${name}, in ${currency}`;
}

/** One benchmark at a time, or none. The names come from the API's
 *  BENCHMARKS — this file holds no copy of them. */
function CompareControl({
  options,
  value,
  onChange,
}: {
  options: BenchmarkOptionDTO[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const active = options.find((o) => o.id === value) ?? null;
  const choices: { id: string | null; name: string }[] = [
    { id: null, name: "No comparison" },
    ...options,
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={active ? "default" : "outline"} size="sm">
          {active ? `vs ${active.name}` : "Compare"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div role="radiogroup" aria-label="Compare with" className="flex flex-col">
          {choices.map((o) => (
            <button
              key={o.id ?? "none"}
              type="button"
              role="radio"
              aria-checked={value === o.id}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className="rounded-control px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:font-medium aria-checked:text-foreground"
            >
              {o.name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const INITIAL_RANGE: RangeKey = "1Y";

/** The container is `h-60 md:h-80` — 240px below md, 320px from md — and the
 *  chart takes the container's height, so the breakpoint lives in CSS alone.
 *  This is the fallback before layout (and in jsdom). */
const FALLBACK_HEIGHT = 240;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface AssetPriceChartProps {
  slug: string;
  initialChart: { date: string; close: MoneyDTO }[];
  position: AssetPositionDTO;
  /** The page's own dividend history. The markers and the total-return line
   *  read it, so neither can disagree with the payments list. */
  dividends: AssetDividendsDTO["history"];
  /** The header's readout: the resting readout whenever the line changes, the
   *  hovered day's readout while scrubbing, null on unmount. */
  onReadout?: (readout: ChartReadout | null) => void;
}

export function AssetPriceChart({
  slug,
  initialChart,
  position,
  dividends,
  onReadout,
}: AssetPriceChartProps) {
  const [range, setRange] = React.useState<RangeKey>(INITIAL_RANGE);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  const trades = React.useMemo(() => position.trades ?? [], [position.trades]);
  const [showTrades, setShowTrades] = React.useState(trades.length <= 15);
  // The primitives read visibility each frame; refs keep it current without
  // making the toggles dependencies of the chart-construction effect.
  const showTradesRef = React.useRef(showTrades);
  showTradesRef.current = showTrades;
  const [showDividends, setShowDividends] = React.useState(true);
  const showDividendsRef = React.useRef(showDividends);
  showDividendsRef.current = showDividends;
  const onReadoutRef = React.useRef(onReadout);
  onReadoutRef.current = onReadout;

  const { data, isLoading } = useQuery({
    queryKey: qk.assetChart(slug, range),
    queryFn: () => getAssetChart(slug, range),
    staleTime: 300_000,
    initialData: range === INITIAL_RANGE ? initialChart : undefined,
  });
  const rawChart = React.useMemo(() => data ?? [], [data]);
  const currency = rawChart[0]?.close.currency ?? "USD";
  const closes = React.useMemo(
    () => rawChart.map((p) => ({ date: p.date, close: Number(p.close.amount) })),
    [rawChart],
  );

  const [mode, setMode] = React.useState<ChartMode>("price");
  const [compareId, setCompareId] = React.useState<string | null>(null);
  const { data: benchmarks } = useQuery({
    queryKey: qk.benchmarks(),
    queryFn: () => getBenchmarks(),
    staleTime: Infinity,
  });
  const from = rawChart[0]?.date ?? null;
  const to = rawChart[rawChart.length - 1]?.date ?? null;
  // The index comes back already in the holding's currency (`currency`, the
  // chart's own): the server converts at each day's ECB rate, the client only
  // rebases to % change.
  const benchQuery = useQuery({
    queryKey: qk.benchmarkSeries(compareId ?? "", from ?? "", to ?? "", currency),
    queryFn: () => getBenchmarkSeries(compareId!, from!, to!, currency),
    enabled: compareId !== null && from !== null && to !== null,
    staleTime: 300_000,
    retry: false,
  });
  const baseName = benchmarks?.find((b) => b.id === compareId)?.name ?? null;
  const compareName = baseName ? benchmarkLabel(baseName, currency) : null;
  const benchSeries = benchQuery.data?.series ?? null;
  const benchmark = React.useMemo(
    () =>
      benchSeries && compareName
        ? {
            name: compareName,
            bars: benchSeries.bars.map((b) => ({ date: b.date, close: Number(b.close) })),
          }
        : null,
    [benchSeries, compareName],
  );
  // Never a silent fallback: a series that failed or came back null is
  // "unavailable" — "unavailable in <CCY>" when the reason is a missing rate —
  // and the chart stays on the holding's own line, never an unconverted one.
  const compare = React.useMemo<CompareContext | null>(() => {
    if (compareId === null || baseName === null || compareName === null) return null;
    if (benchQuery.isPending) return { name: compareName, status: "pending", reason: null };
    if (benchSeries) return { name: compareName, status: "ready", reason: null };
    const reason =
      benchQuery.data?.reason === "no_fx_rate"
        ? `${baseName} unavailable in ${currency}`
        : `${baseName} unavailable`;
    return { name: compareName, status: "unavailable", reason };
  }, [
    compareId,
    baseName,
    compareName,
    currency,
    benchQuery.isPending,
    benchQuery.data,
    benchSeries,
  ]);

  const model = React.useMemo(
    () =>
      buildChartModel({
        closes,
        currency,
        dividends,
        mode,
        benchmark,
      }),
    [closes, currency, dividends, mode, benchmark],
  );
  const comparing = model.axis === "percent";

  const readoutCtx = React.useMemo(
    () => ({ rangePhrase: RANGE_PHRASE[range], currency, compare }),
    [range, currency, compare],
  );
  const readoutCtxRef = React.useRef(readoutCtx);
  readoutCtxRef.current = readoutCtx;

  // The resting readout — the whole range, to today — whenever the line changes.
  React.useEffect(() => {
    onReadoutRef.current?.(model.holding.length > 0 ? readoutAt(model, null, readoutCtx) : null);
  }, [model, readoutCtx]);
  React.useEffect(() => () => onReadoutRef.current?.(null), []);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || model.holding.length === 0) return;
    const theme = readChartTheme();
    chartRef.current?.remove();

    const base = baseChartOptions(
      theme,
      el.clientWidth,
      el.clientHeight || FALLBACK_HEIGHT,
      range === "1W",
    );
    // The built-in vertical line welds to the cursor; EasedCrosshair draws one
    // that eases (DESIGN.md Motion).
    const chart = createChart(el, {
      ...base,
      crosshair: { ...base.crosshair, vertLine: { ...base.crosshair?.vertLine, visible: false } },
    });

    const lineColor = lineColorFor(model.direction, theme);
    const series = chart.addSeries(AreaSeries, {
      ...areaSeriesOptions(theme, lineColor),
      crosshairMarkerVisible: false,
    });
    series.setData(model.holding);
    if (model.benchmark) {
      const bm = chart.addSeries(LineSeries, benchmarkSeriesOptions(theme));
      bm.setData(model.benchmark);
    }

    const formatValue = (v: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(v);

    // The average cost is a price: meaningless on a total-return line or a
    // percent axis.
    if (
      position.held &&
      position.averageCost &&
      model.axis === "price" &&
      model.lineMode === "price"
    ) {
      series.createPriceLine({
        price: Number(position.averageCost.amount),
        color: theme.costLine,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `Avg cost ${formatValue(Number(position.averageCost.amount))}`,
      });
    }

    // Snap a trade onto the nearest bar at or before its date (ascending data,
    // backward scan). A trade before the first bar is off-screen and dropped.
    const resolveBar = (time: string) => {
      for (let i = model.holding.length - 1; i >= 0; i--) {
        const bar = model.holding[i]!;
        if (bar.time <= time) return bar;
      }
      return undefined;
    };
    series.attachPrimitive(
      new TradeMarkers(
        chart,
        series,
        resolveBar,
        () => (showTradesRef.current ? tradeMarks(trades) : []),
        () => readChartTheme(),
      ),
    );

    const divMarks: DividendMark[] = model.dividendsInRange.map((d, i) => ({
      time: d.exDate,
      id: `div-${i}`,
    }));
    // An ex-date with no bar (a weekend) sits on the next bar — where total
    // return books it.
    const resolveDivTime = (time: string) => model.holding.find((b) => b.time >= time)?.time;
    series.attachPrimitive(
      new DividendMarkers(
        chart,
        resolveDivTime,
        () => (showDividendsRef.current ? divMarks : []),
        () => readChartTheme(),
      ),
    );

    const crosshair = new EasedCrosshair(
      () => ({ line: withChartAlpha(theme.text, 0.45), dot: lineColor, halo: theme.card }),
      prefersReducedMotion,
    );
    series.attachPrimitive(crosshair);

    chart.timeScale().fitContent();

    const resolveMarker = (id: unknown): MarkerTip | null => {
      if (typeof id !== "string") return null;
      if (id.startsWith("trade-")) {
        const t = trades[Number(id.slice("trade-".length))];
        if (!t) return null;
        return {
          // The triangle says which way, in ink — never green for "buy".
          primary: t.type === "buy" ? "▲ Buy" : "▼ Sell",
          secondary: `${Number(t.quantity)} sh · ${formatValue(Number(t.price))} · ${formatDate(t.tradeDate, { year: "always" })}`,
          colorClass: "text-foreground",
        };
      }
      if (id.startsWith("div-")) {
        const d = model.dividendsInRange[Number(id.slice("div-".length))];
        if (!d) return null;
        const amount = `${formatPerShare({ amount: String(d.amountPerShare), currency: d.currency })} / share, gross`;
        return {
          primary: "Ex-dividend",
          secondary: d.paymentDate
            ? `${amount} · paid ${formatDate(d.paymentDate, { year: "always" })}`
            : amount,
          colorClass: "text-foreground",
        };
      }
      return null;
    };
    // Marker labels only: the hovered price is the header's now.
    const detachTooltip = attachHoverTooltip(chart, series, el, formatValue, resolveMarker, {
      showValue: false,
    });

    let lastDate: string | null | undefined;
    const onMove = (param: MouseEventParams) => {
      const t = typeof param.time === "string" && param.point ? param.time : null;
      const bar = t ? resolveBar(t) : undefined;
      const x = t ? chart.timeScale().timeToCoordinate(t) : null;
      const y = bar ? series.priceToCoordinate(bar.value) : null;
      crosshair.setTarget(x !== null && y !== null ? { x, y } : null);
      // Figures change instantly, once per day crossed — not on every pixel.
      if (t !== lastDate) {
        lastDate = t;
        onReadoutRef.current?.(readoutAt(model, t, readoutCtxRef.current));
      }
    };
    chart.subscribeCrosshairMove(onMove);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      chart.applyOptions({ width, height: height || FALLBACK_HEIGHT });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      detachTooltip();
      // chart.remove() does not detach primitives; the crosshair owns an rAF loop.
      series.detachPrimitive(crosshair);
      chart.remove();
      chartRef.current = null;
    };
    // The toggles reach the primitives through refs; the effect below nudges a
    // redraw, so they stay out of this list (they would rebuild the whole chart).
  }, [model, resolvedTheme, position.held, position.averageCost, trades, range, currency]);

  React.useEffect(() => {
    chartRef.current?.applyOptions({});
  }, [showTrades, showDividends, trades]);

  if (isLoading) return <ChartSkeleton />;
  if (model.holding.length === 0) {
    return <p className="text-sm text-muted-foreground">No price data available for this range.</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="relative h-60 md:h-80" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedControl
            options={RANGES}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
            size="sm"
          />
          <span
            title={
              model.trUnavailable ? `Total return unavailable: ${model.trUnavailable}` : undefined
            }
          >
            <SegmentedControl
              options={MODES}
              value={model.lineMode}
              onChange={(v) => setMode(v as ChartMode)}
              size="sm"
              // A comparison is always on total return — a price line against
              // a TR index is the bias Sage removed from /performance.
              disabled={comparing || model.trUnavailable !== null}
            />
          </span>
          {comparing && (
            <span className="text-xs text-muted-foreground">compared on total return</span>
          )}
          {benchmarks && benchmarks.length > 0 && (
            <CompareControl options={benchmarks} value={compareId} onChange={setCompareId} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {showDividends && model.dividendsInRange.length > 0 && (
              <span className="flex items-center gap-1.5">
                <i
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: "var(--certainty-paid)" }}
                />
                Ex-dividend
              </span>
            )}
            {showTrades && trades.length > 0 && (
              <>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="text-foreground">
                    ▲
                  </span>
                  Buy
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="text-foreground">
                    ▼
                  </span>
                  Sell
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {model.dividendsInRange.length > 0 && (
              <Button
                variant={showDividends ? "default" : "outline"}
                size="sm"
                aria-pressed={showDividends}
                onClick={() => setShowDividends((v) => !v)}
              >
                Dividends
              </Button>
            )}
            {trades.length > 0 && (
              <Button
                variant={showTrades ? "default" : "outline"}
                size="sm"
                aria-pressed={showTrades}
                onClick={() => setShowTrades((v) => !v)}
              >
                Trades
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
