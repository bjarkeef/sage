import {
  ColorType,
  LineStyle,
  TickMarkType,
  type AreaSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type ISeriesApi,
  type LineSeriesPartialOptions,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";

/** Normalize a lightweight-charts Time (ISO string, epoch seconds, or
 *  BusinessDay) into a UTC Date for tick labeling. */
function tickDate(time: Time): Date {
  if (typeof time === "string") return new Date(`${time}T00:00:00Z`);
  if (typeof time === "number") return new Date(time * 1000);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
}

export interface ChartTheme {
  line: string;
  text: string;
  card: string;
  comparison1: string;
  comparison2: string;
  hairline: string;
  primary: string;
  gain: string;
  loss: string;
  costLine: string;
  marker: string;
  markerHalo: string;
}

/** Read chart colors from the active theme's CSS custom properties. Client-only. */
export function readChartTheme(): ChartTheme {
  const resolve = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return {
    line: resolve("--chart-line"),
    text: resolve("--muted-foreground"),
    card: resolve("--card"),
    comparison1: resolve("--chart-comparison-1"),
    comparison2: resolve("--chart-comparison-2"),
    hairline: resolve("--hairline"),
    primary: resolve("--primary"),
    gain: resolve("--gain"),
    loss: resolve("--loss"),
    costLine: resolve("--muted-foreground"),
    marker: resolve("--chart-marker"),
    markerHalo: resolve("--chart-marker-halo"),
  };
}

export function baseChartOptions(
  theme: ChartTheme,
  width: number,
  height: number,
  // Abbreviation is an axis-level property: a chart whose shortest selectable
  // range is a month or longer (performance, most of the portfolio/asset
  // charts) must never surface a day-level tick, even though
  // lightweight-charts still hands the formatter a DayOfMonth-typed tick at
  // those spans. Only a range genuinely shorter than a month (the "1W" chip)
  // should opt in to day granularity.
  allowDayTicks = false,
): DeepPartial<ChartOptions> {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: theme.text,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: true, color: theme.hairline },
    },
    crosshair: {
      vertLine: { color: theme.hairline, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    timeScale: {
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      // One label grammar per axis: the year appears once, at the boundary
      // where it changes, and every other tick reads as a month name. Narrow
      // widths (and month-or-longer ranges generally) make lightweight-charts
      // hand out DayOfMonth-typed ticks alongside Month ones — without
      // `allowDayTicks`, those still render as a month name rather than a
      // bare day-of-month digit or a "MMM d" label mixed in with "MMM" ones.
      tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
        const d = tickDate(time);
        if (tickMarkType === TickMarkType.Year) return String(d.getUTCFullYear());
        if (tickMarkType === TickMarkType.Month || !allowDayTicks)
          return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      },
    },
    rightPriceScale: { visible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
    handleScroll: { vertTouchDrag: false },
  };
}

/** The area line is always the sage accent — direction is carried by Delta, not hue.
 *  No pinned last-price label or price line: the number lives in the page hero. */
export function areaSeriesOptions(theme: ChartTheme): AreaSeriesPartialOptions {
  return {
    lineColor: theme.line,
    topColor: `${theme.line}2E`,
    bottomColor: `${theme.line}00`,
    lineWidth: 2,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: theme.card,
    crosshairMarkerBackgroundColor: theme.line,
  };
}

export function comparisonSeriesOptions(theme: ChartTheme, index: 0 | 1): LineSeriesPartialOptions {
  return {
    color: index === 0 ? theme.comparison1 : theme.comparison2,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    crosshairMarkerVisible: false,
    lastValueVisible: false,
  };
}

/** Content for a trade-marker tooltip: a colored headline (Buy/Sell) over a
 *  muted detail line (price · date). */
export interface MarkerTip {
  primary: string;
  secondary: string;
  /** Token text-color class for the headline, e.g. "text-primary" / "text-loss". */
  colorClass: string;
}

/** Floating tooltip following the crosshair. Shows the hovered trade marker's
 *  details when `resolveMarker` returns one for the hovered object; otherwise
 *  the series value + date. Returns a cleanup function. Container must be
 *  position:relative. */
export function attachHoverTooltip(
  chart: IChartApi,
  series: ISeriesApi<"Area">,
  container: HTMLElement,
  formatValue: (value: number) => string,
  resolveMarker?: (id: unknown) => MarkerTip | null,
): () => void {
  const tip = document.createElement("div");
  tip.className =
    "pointer-events-none absolute z-10 hidden rounded-control border border-hairline bg-popover px-2.5 py-1.5 text-popover-foreground font-mono text-xs shadow-md";
  container.appendChild(tip);

  const place = (x0: number, y0: number) => {
    tip.classList.remove("hidden");
    const x = Math.min(Math.max(x0 + 12, 0), container.clientWidth - tip.offsetWidth - 8);
    const y = Math.max(y0 - tip.offsetHeight - 12, 0);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const onMove = (param: MouseEventParams) => {
    // A hovered trade marker takes precedence over the price/date readout.
    const marker = resolveMarker?.(param.hoveredObjectId);
    if (marker && param.point) {
      tip.replaceChildren();
      const head = document.createElement("div");
      head.className = `${marker.colorClass} font-medium`;
      head.textContent = marker.primary;
      const detail = document.createElement("div");
      detail.className = "text-muted-foreground";
      detail.textContent = marker.secondary;
      tip.append(head, detail);
      place(param.point.x, param.point.y);
      return;
    }

    const data = param.seriesData.get(series) as { value?: number } | undefined;
    if (!param.point || !param.time || data?.value == null) {
      tip.classList.add("hidden");
      return;
    }
    tip.replaceChildren();
    const val = document.createElement("div");
    val.textContent = formatValue(data.value);
    const date = document.createElement("div");
    date.className = "text-muted-foreground";
    // Time is string | UTCTimestamp | BusinessDay; our series use "YYYY-MM-DD" strings.
    const t = param.time;
    const dateKey =
      typeof t === "string"
        ? t
        : typeof t === "number"
          ? new Date(t * 1000).toISOString().slice(0, 10)
          : `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    date.textContent = new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    tip.append(val, date);
    place(param.point.x, param.point.y);
  };

  chart.subscribeCrosshairMove(onMove);
  return () => {
    chart.unsubscribeCrosshairMove(onMove);
    tip.remove();
  };
}
