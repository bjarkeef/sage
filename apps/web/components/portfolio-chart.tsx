"use client";

import * as React from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  createChart,
  AreaSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type MouseEventParams,
} from "lightweight-charts";
import { createGainBand, type GainBandPoint } from "./charts/gain-band";
import { createCurtain } from "./charts/curtain";
import { useTheme } from "next-themes";
import { SegmentedControl, Delta, Stat, StatStrip } from "@sage/ui";
import { getPortfolioHistory } from "../lib/api";
import { qk } from "../lib/query/keys";
import { moneyToNumber, formatMoney } from "../lib/format";
import { AmbientChartSkeleton, HeroSkeleton } from "./skeletons";
import { FxApproximatedCallout } from "./fx-approximated-callout";
import { FxStaleCallout } from "./fx-stale-callout";
import { FxUnavailableCallout } from "./fx-unavailable-callout";
import {
  readChartTheme,
  baseChartOptions,
  areaSeriesOptions,
  withChartAlpha,
} from "../lib/chart-config";
import type { DashboardDTO, PortfolioHistoryDTO, PortfolioHistoryPoint } from "../lib/types";

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

/* Benchmark overlays were removed from this chart on 2026-09-10, deliberately.
 *
 * This series is your portfolio's ABSOLUTE VALUE in the display currency, so it
 * steps up the moment you deposit. A benchmark can only be drawn here as a
 * percentage, on its own independent price scale — which meant one line moved
 * with your cash flows and the other structurally could not, on two axes that
 * autoscaled separately. Where the lines sat relative to each other, and where
 * they crossed, carried no information at all: a book with steady inflows drew
 * itself above the index for depositing money.
 *
 * `/performance` compares against benchmarks correctly and still does — there
 * the portfolio is an index too, so both sides are percentages on one scale.
 *
 * The right version of this chart is an index-equivalent line: the same cash
 * flows, on the same dates, invested into the index instead, drawn in currency
 * beside the value and "Money in". Until that exists, no benchmark belongs
 * here. `/portfolio/history` still accepts a `benchmarks` param, and this was
 * its only caller.
 */

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
  /** The day under the pointer, or null on the way out. Lets an owner render
   *  the hero numeral from the chart, so the two are one instrument rather than
   *  a figure stacked above a picture.
   *
   *  Deliberately NOT fired during the entrance. The numeral was briefly made
   *  to travel from the range's opening value to today's, as the mockup did —
   *  but the overview is server-rendered, so today's figure is in the HTML and
   *  on screen before React is alive. Measured: 343,029 painted at 209ms, then
   *  the chart mounted and pulled it back to 279,435. The number was right,
   *  then snapped backwards and re-earned itself, which reads as a fault.
   *
   *  Starting it lower would mean shipping a figure in the SSR HTML that is not
   *  the portfolio's value, which is not a trade this app makes for a flourish.
   *  The mockup could do it because it had no server render. */
  onScrub?: (point: PortfolioHistoryPoint | null) => void;
  /** Rendered on the same row as the range control. The overview passes its
   *  hero numeral here so the figure, the range pills and the plot read as one
   *  object — apart, with a gap between them, they read as three stacked
   *  blocks, which is what made this feel like a number sitting above a
   *  picture rather than one instrument. */
  header?: React.ReactNode;
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
  onScrub,
  header,
}: PortfolioChartProps) {
  const ambient = variant === "ambient";
  const [range, setRange] = React.useState(INITIAL_RANGE);
  // The server-rendered initialHistory was fetched with whatever displayCurrency
  // this component first mounted with; capture it once so a later currency
  // change (a new prop value, same mounted instance) doesn't keep seeding stale
  // initialData forever -- it only seeds the exact key the server prefetched.
  const [scrubbed, setScrubbed] = React.useState<PortfolioHistoryPoint | null>(null);
  // Held in a ref so a new callback identity never rebuilds the chart: the
  // effect below tears down and recreates it, which would restart the entrance.
  const onScrubRef = React.useRef(onScrub);
  onScrubRef.current = onScrub;

  const initialCurrencyRef = React.useRef(displayCurrency ?? undefined);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: qk.portfolioHistory(range, displayCurrency ?? undefined),
    queryFn: () => getPortfolioHistory(range, displayCurrency ?? undefined),
    staleTime: 300_000,
    // Keep the previous range's chart on screen while a new range fetches, so
    // switching timelines never collapses the block into a skeleton (no CLS,
    // and the range control stays put). isLoading is then true only on the
    // genuine first load with no seeded/cached data.
    placeholderData: keepPreviousData,
    initialData:
      range === INITIAL_RANGE && (displayCurrency ?? undefined) === initialCurrencyRef.current
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

  /** Value and money in on one row per day, for the band between them. */
  const bandData = React.useMemo<GainBandPoint[]>(
    () =>
      data?.points.map((p) => ({
        time: p.date,
        value: Number(p.value.amount),
        invested: Number(p.invested.amount),
      })) ?? [],
    [data],
  );
  const bandRef = React.useRef<GainBandPoint[]>([]);
  bandRef.current = bandData;

  // The entrance is once per MOUNT, not per render: switching range refetches
  // and rebuilds the chart, and replaying the draw every time would be a
  // stutter rather than a welcome. See DESIGN.md, Motion.
  const hasEnteredRef = React.useRef(false);
  /** 0-1 sweep for the entrance curtain; 1 means fully revealed. */
  const revealRef = React.useRef(1);
  /** Where the hover veil starts, as a fraction of pane width; null when the
   *  pointer is off the plot. */
  const veilRef = React.useRef<number | null>(null);
  const requestChartUpdateRef = React.useRef<(() => void) | null>(null);

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

    // The area's own gradient fills from the value line to the floor of the
    // pane, which is very nearly the same region the gain band fills — two
    // washes over one area, and the band stops reading as a *band*. With the
    // fill off, the only shaded region on the chart is the space between value
    // and money in, and the empty ground beneath money in is what makes that
    // space legible as a quantity. The series stays an AreaSeries for its
    // crosshair marker options.
    const series = chart.addSeries(AreaSeries, {
      ...areaSeriesOptions(theme),
      ...(investedData.length > 0 ? { topColor: "transparent", bottomColor: "transparent" } : {}),
    });
    series.setData(chartData);

    // Money in is drawn always, not behind a toggle. Without it the band has no
    // floor and the gain has nothing to be measured from — it is structure now,
    // not an option, and the toggle it replaced was off by default, so the
    // honest reading was the one nobody saw.
    const investedSeries =
      investedData.length > 0
        ? chart.addSeries(LineSeries, {
            // Brighter and thicker than the 0.55/1px it was. At the old weight
            // the line read as dotted noise along the floor of the pane rather
            // than as the series the whole gain band is measured from — and a
            // band whose floor you cannot see is just a fill.
            color: withAlpha(theme.text, 0.85),
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            lastValueVisible: false,
            priceLineVisible: false,
            // A dot on this line as well as on the value line: the readout
            // below shows both figures, so both should be pinned on the chart.
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3,
            crosshairMarkerBorderColor: theme.background,
            crosshairMarkerBackgroundColor: withAlpha(theme.text, 0.85),
          })
        : null;
    investedSeries?.setData(investedData);

    if (investedSeries) {
      series.attachPrimitive(
        createGainBand({
          points: () => bandRef.current,
          gainFill: () => withAlpha(theme.gain, 0.15),
          lossFill: () => withAlpha(theme.loss, 0.14),
        }),
      );

      // The entrance sweep, and the hover veil. Same rectangle, different jobs:
      // one hides what has not been drawn yet, the other dims what comes after
      // the pointer.
      series.attachPrimitive(
        createCurtain({
          from: () => (revealRef.current >= 1 ? null : revealRef.current),
          fill: () => theme.background,
          onAttach: (requestUpdate) => {
            requestChartUpdateRef.current = requestUpdate;
          },
        }),
      );
      series.attachPrimitive(
        createCurtain({
          from: () => veilRef.current,
          fill: () => withChartAlpha(theme.background, 0.62),
        }),
      );
    }

    chart.timeScale().fitContent();

    // ---- data-bearing entrance (DESIGN.md, Motion) ----------------------
    // Both series draw left to right under ONE clock, and the band's reveal
    // reads the same clock, so the fill can never run ahead of the lines that
    // bound it. The price scale is frozen for the duration: without that, a
    // chart holding two days of data autoscales to those two days and the whole
    // drawing lurches as more arrives.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    // The flag has to mean "an entrance FINISHED", not "one was started".
    // React StrictMode invokes this effect twice on mount in development: the
    // first pass started the animation and set the flag, the cleanup cancelled
    // it, and the second pass saw the flag and drew the chart instantly — so the
    // entrance never once played, and looked from the outside exactly like a
    // reduced-motion machine.
    let entranceCompleted = false;

    const finish = () => {
      entranceCompleted = true;
      revealRef.current = 1;
      requestChartUpdateRef.current?.();
    };

    if (!hasEnteredRef.current && !prefersReduced && chartData.length > 8) {
      hasEnteredRef.current = true;
      // The series already hold ALL their data and never change during the
      // entrance — only the curtain moves. That is the whole fix: feeding a
      // growing slice made lightweight-charts re-anchor the visible range to
      // the newest bars every frame, so the drawing appeared crammed at the
      // right edge at the wrong bar spacing and expanded leftwards. It read as
      // the chart flying in from the right and snapping into place.
      revealRef.current = 0;
      const start = performance.now();
      const DURATION_MS = 900;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION_MS);
        // Ease in AND out. `1 - (1-t)^3` put 58% of the drawing on screen in
        // the first quarter of the time and spent the second half covering the
        // last 12% — a snap followed by a crawl.
        revealRef.current = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        requestChartUpdateRef.current?.();
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          raf = 0;
          finish();
        }
      };
      raf = requestAnimationFrame(step);
    } else {
      // Reduced motion, a range change, or too few points to be worth
      // animating: the resting state IS the truth, so it is simply drawn. This
      // counts as complete so the cleanup below does not re-arm the entrance and
      // make the NEXT range change animate.
      hasEnteredRef.current = true;
      entranceCompleted = true;
      revealRef.current = 1;
    }

    // Drive the readout from the crosshair. `param.time` is the series time —
    // the ISO date these points are keyed by — so the lookup is exact rather
    // than a nearest-x search.
    const pointByDate = new Map((data?.points ?? []).map((p) => [p.date, p]));
    const onCrosshair = (param: MouseEventParams) => {
      const t = param.time;
      const hit = typeof t === "string" ? (pointByDate.get(t) ?? null) : null;
      const width = containerRef.current?.clientWidth ?? 0;
      veilRef.current = hit && param.point && width > 0 ? param.point.x / width : null;
      requestChartUpdateRef.current?.();
      setScrubbed((prev) => {
        if (prev?.date === hit?.date) return prev;
        onScrubRef.current?.(hit);
        return hit;
      });
    };
    chart.subscribeCrosshairMove(onCrosshair);

    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width } = entries[0]!.contentRect;
      chart.applyOptions({ width });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      // Torn down before it finished (StrictMode's first pass, or a fast
      // unmount): give the entrance back, so the mount that survives plays it.
      if (!entranceCompleted) hasEnteredRef.current = false;
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshair);
      veilRef.current = null;
      requestChartUpdateRef.current = null;
      setScrubbed(null);
      onScrubRef.current?.(null);
      chart.remove();
      chartRef.current = null;
    };
    // data?.points is already captured via chartData (derived from it); adding it
    // would rebuild the chart on every refetch that produced identical points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, investedData, resolvedTheme, ambient]);

  // The header outlives the chart. It carries the owner's hero numeral, and a
  // book with no price history yet — a first day, or a first import — still has
  // a value to show. Returning early without it made the largest figure on the
  // page disappear on exactly the accounts least able to spare it; there are
  // tests for this in `overview-client.test.tsx` because it has happened before.
  if (isLoading) {
    return (
      <div className="space-y-4">
        {header}
        {ambient ? <AmbientChartSkeleton /> : <HeroSkeleton />}
      </div>
    );
  }
  if (!data || data.points.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <p className="text-muted-foreground text-sm">Not enough data for a chart yet.</p>
      </div>
    );
  }

  const lastPoint = data.points[data.points.length - 1]!;
  // Value minus money in. Both are already in the display currency by the time
  // they reach here, so this is a subtraction rather than a conversion.
  // The strip reads the day under the pointer, falling back to the last day.
  // Figures change instantly rather than tweening: several numerals easing
  // under a moving hand reads as a slot machine (DESIGN.md, Motion).
  const shown = scrubbed ?? lastPoint;
  const gainAmount = Number(shown.value.amount) - Number(shown.invested.amount);
  const investedShown = Number(shown.invested.amount);
  const gainPercent = investedShown > 0 ? (gainAmount / investedShown) * 100 : null;
  const rangeLabel = RANGE_LABEL[range] ?? range;

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-end gap-x-4 gap-y-2 ${
          ambient && !header ? "justify-end" : "justify-between"
        }`}
      >
        {header}
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
          <HeroMoney money={shown.value} />
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

      {/* What was paid in, and the space between that and the value — the one
          figure on this chart a deposit cannot move, since a deposit lifts value
          and money in by the same amount on the same day.

          Deliberately NOT three cells. Both variants already print the value as
          the hero numeral directly above, so a "Worth" cell repeats it a few
          pixels lower; CI caught the duplicate before the design review did.
          The hero IS the worth, and the strip finishes the sentence: worth that
          much, this much put in, so this much is gain.

          The swatch sits on the label so a figure and the line it names are one
          object rather than a colour match across a gap. */}
      <StatStrip>
        <Stat
          size="sm"
          label={
            <span className="flex items-center gap-2">
              <span
                data-series-swatch
                className="h-0.5 w-4 flex-none"
                style={{
                  background:
                    "repeating-linear-gradient(to right, var(--muted-foreground) 0 3px, transparent 3px 6px)",
                }}
              />
              Money in
            </span>
          }
          value={formatMoney(shown.invested)}
          // Kept from the toggle this replaced: the distinction is easy to get
          // wrong and the label alone cannot carry it.
          title="Contributions minus withdrawals. Sits below the cost of your current holdings once you have sold at a profit, because those gains were reinvested."
        />
        <Stat
          size="sm"
          label={
            <span className="flex items-center gap-2">
              <span
                data-series-swatch
                className="h-2.5 w-3.5 flex-none rounded-badge border"
                style={{
                  background: gainAmount >= 0 ? "var(--gain)" : "var(--loss)",
                  borderColor: gainAmount >= 0 ? "var(--gain)" : "var(--loss)",
                  opacity: 0.5,
                }}
              />
              Gain
            </span>
          }
          value={
            <Delta
              value={gainAmount}
              percent={gainPercent ?? undefined}
              currency={shown.value.currency}
            />
          }
        />
      </StatStrip>

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
