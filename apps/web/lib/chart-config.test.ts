// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { LineStyle, TickMarkType, type Time, type TickMarkFormatter } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import {
  areaSeriesOptions,
  attachHoverTooltip,
  baseChartOptions,
  comparisonSeriesOptions,
  withChartAlpha,
} from "./chart-config";

const theme = {
  line: "#3d6a4d",
  border: "#333333",
  text: "#888888",
  background: "#0d0d0c",
  card: "#ffffff",
  comparison1: "#918c80",
  comparison2: "#93b0a0",
  hairline: "rgba(20, 20, 19, 0.09)",
  primary: "#3d6a4d",
  gain: "#3dbe86",
  loss: "#b23b3b",
  costLine: "#888888",
  // Deliberately not `primary`/`line`: trade markers must never resolve to the
  // color of the line they sit on. See tradeMarkers in asset-price-chart.tsx.
  marker: "#0a0a0a",
  markerHalo: "#ffffff",
};

describe("chart-config", () => {
  it("area series always uses the theme line color with alpha ramp and no pinned last value", () => {
    const opts = areaSeriesOptions(theme);
    expect(opts.lineColor).toBe("#3d6a4d");
    expect(opts.topColor).toBe("#3d6a4d2E");
    expect(opts.bottomColor).toBe("#3d6a4d00");
    expect(opts.lineWidth).toBe(2);
    expect(opts.lastValueVisible).toBe(false);
    expect(opts.priceLineVisible).toBe(false);
    expect(opts.crosshairMarkerBackgroundColor).toBe("#3d6a4d");
    expect(opts.crosshairMarkerBorderColor).toBe("#ffffff");
  });

  it("comparison series are muted, thin, dashed, unlabeled", () => {
    const first = comparisonSeriesOptions(theme, 0);
    const second = comparisonSeriesOptions(theme, 1);
    expect(first.color).toBe("#918c80");
    expect(second.color).toBe("#93b0a0");
    expect(first.lineWidth).toBe(1);
    expect(first.lineStyle).toBe(LineStyle.Dashed);
    expect(first.lastValueVisible).toBe(false);
    expect(first.crosshairMarkerVisible).toBe(false);
  });

  it("base options hide scale chrome and use a hairline grid", () => {
    const opts = baseChartOptions(theme, 800, 240);
    expect(opts.width).toBe(800);
    expect(opts.height).toBe(240);
    expect(opts.grid?.vertLines?.visible).toBe(false);
    expect(opts.grid?.horzLines?.visible).toBe(true);
    expect(opts.grid?.horzLines?.color).toBe(theme.hairline);
    expect(opts.timeScale?.borderVisible).toBe(false);
    expect(opts.rightPriceScale?.visible).toBe(false);
    expect(opts.rightPriceScale?.scaleMargins).toEqual({ top: 0.12, bottom: 0.12 });
    // NOT the hairline. `--hairline` is alpha .07 — correct for a card border,
    // and as a crosshair it is drawn and invisible, which is the same thing as
    // having none. It has to be legibly stronger than the grid it crosses.
    expect(opts.crosshair?.vertLine?.color).not.toBe(theme.hairline);
    expect(opts.crosshair?.vertLine?.color).toBe(withChartAlpha(theme.text, 0.45));
    expect(opts.crosshair?.vertLine?.style).toBe(LineStyle.Dashed);
    expect(opts.crosshair?.vertLine?.labelVisible).toBe(false);
    expect(opts.crosshair?.horzLine?.visible).toBe(false);
    expect(opts.handleScroll).toEqual({ vertTouchDrag: false });
    expect(opts.layout?.attributionLogo).toBe(false);
  });

  describe("tickMarkFormatter", () => {
    // Dec 2, 2026 — a day-level tick candidate mid-way through a longer range.
    const dayTime = "2026-12-02" as Time;
    const yearTime = "2026-01-01" as Time;
    const monthTime = "2026-03-01" as Time;

    // DeepPartial<ChartOptions> makes DeepPartial<TickMarkFormatter> a
    // non-callable object type; the real value is always a plain function.
    function formatterOf(allowDayTicks?: boolean): TickMarkFormatter {
      const { timeScale } = baseChartOptions(theme, 800, 240, allowDayTicks);
      return timeScale!.tickMarkFormatter as unknown as TickMarkFormatter;
    }

    it("never labels a day-level tick with the day, by default", () => {
      // The defect: at ranges of a month or longer, lightweight-charts still
      // hands the formatter a DayOfMonth-typed tick, and without an explicit
      // override it read as "Dec 2" sitting between month names.
      const label = formatterOf()(dayTime, TickMarkType.DayOfMonth, "en-US");
      expect(label).toBe("Dec");
      expect(label).not.toContain("2");
    });

    it("keeps day-level detail when the caller opts in for a short range", () => {
      const label = formatterOf(true)(dayTime, TickMarkType.DayOfMonth, "en-US");
      expect(label).toBe("Dec 2");
    });

    it("shows the bare year once, at the boundary, regardless of the flag", () => {
      for (const allowDayTicks of [false, true]) {
        const label = formatterOf(allowDayTicks)(yearTime, TickMarkType.Year, "en-US");
        expect(label).toBe("2026");
      }
    });

    it("shows the month name for a month-boundary tick, regardless of the flag", () => {
      for (const allowDayTicks of [false, true]) {
        const label = formatterOf(allowDayTicks)(monthTime, TickMarkType.Month, "en-US");
        expect(label).toBe("Mar");
      }
    });
  });
});

describe("attachHoverTooltip", () => {
  it("mounts a tooltip div and cleans up on the returned function", () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    const chart = {
      subscribeCrosshairMove: subscribe,
      unsubscribeCrosshairMove: unsubscribe,
    } as unknown as IChartApi;
    const series = {} as ISeriesApi<"Area">;
    const container = document.createElement("div");

    const cleanup = attachHoverTooltip(chart, series, container, (v) => String(v));
    expect(container.children).toHaveLength(1);
    expect(subscribe).toHaveBeenCalledOnce();

    cleanup();
    expect(container.children).toHaveLength(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("formats the tooltip date as a human-readable string", () => {
    let onMove: ((param: unknown) => void) | undefined;
    const chart = {
      subscribeCrosshairMove: (fn: (param: unknown) => void) => {
        onMove = fn;
      },
      unsubscribeCrosshairMove: vi.fn(),
    } as unknown as IChartApi;
    const series = {} as ISeriesApi<"Area">;
    const container = document.createElement("div");

    attachHoverTooltip(chart, series, container, (v) => `$${v}`);
    onMove!({
      point: { x: 10, y: 50 },
      time: "2026-07-03",
      seriesData: new Map([[series, { value: 123 }]]),
    });

    const tip = container.firstElementChild!;
    expect(tip.textContent).toContain("$123");
    expect(tip.textContent).toContain("Jul 3, 2026");
    expect(tip.textContent).not.toContain("2026-07-03");
  });
});
