import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import type { AssetDividendsDTO, AssetPositionDTO } from "../lib/types";
import type { ChartReadout } from "../lib/asset-chart/readout";
import * as api from "../lib/api";

const { createPriceLine, attachPrimitive, detachPrimitive, subscribeCrosshairMove, addSeries } =
  vi.hoisted(() => {
    const createPriceLine = vi.fn();
    const attachPrimitive = vi.fn();
    const detachPrimitive = vi.fn();
    const series = {
      setData: vi.fn(),
      createPriceLine,
      attachPrimitive,
      detachPrimitive,
      priceToCoordinate: vi.fn(() => 17),
    };
    return {
      createPriceLine,
      attachPrimitive,
      detachPrimitive,
      subscribeCrosshairMove: vi.fn(),
      addSeries: vi.fn(() => series),
    };
  });

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dashed: 2 };
  const ColorType = { Solid: "solid" };
  const chartStub = {
    addSeries,
    // timeToCoordinate/priceToCoordinate place the markers; without them the
    // draw throws rather than drawing.
    timeScale: vi.fn(() => ({ fitContent: vi.fn(), timeToCoordinate: vi.fn(() => 42) })),
    subscribeCrosshairMove,
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    AreaSeries: "Area",
    LineSeries: "Line",
    LineStyle,
    ColorType,
  };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../lib/api", () => ({
  getAssetChart: vi.fn(),
  getBenchmarks: vi.fn(() => Promise.resolve([])),
  getBenchmarkSeries: vi.fn(),
}));

import { AssetPriceChart } from "./asset-price-chart";
import { TradeMarkers } from "./trade-markers";
import { DividendMarkers } from "./dividend-markers";
import { EasedCrosshair } from "./charts/eased-crosshair";

// Chart dates are data for the chart, never compared with the real clock.
const CHART = [
  { date: "2026-06-01", close: { amount: "170", currency: "USD" } },
  { date: "2026-07-01", close: { amount: "180", currency: "USD" } },
];
const DIVIDENDS: AssetDividendsDTO["history"] = [
  { exDate: "2026-06-15", amountPerShare: "1.00", currency: "USD", paymentDate: "2026-06-30" },
];
const HELD: AssetPositionDTO = {
  held: true,
  averageCost: { amount: "150", currency: "USD" },
  trades: [
    { tradeDate: "2026-06-02", type: "buy", price: "168", quantity: "10" },
    { tradeDate: "2026-06-20", type: "sell", price: "175", quantity: "4" },
  ],
};

function drawTarget(withMedia = true) {
  const fills: string[] = [];
  const ctx = {
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    set fillStyle(v: string) {
      fills.push(v);
    },
    get fillStyle() {
      return "";
    },
  };
  const target = {
    useBitmapCoordinateSpace: (fn: (scope: unknown) => void) =>
      fn({
        context: ctx,
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
        ...(withMedia ? { mediaSize: { width: 600, height: 240 } } : {}),
      }),
  };
  return { ctx, fills, target };
}

interface Drawable {
  paneViews: () => { renderer: () => { draw: (t: unknown) => void } }[];
}

function primitive(ctor: new (...args: never[]) => object): Drawable {
  const found: unknown = attachPrimitive.mock.calls
    .map((c: unknown[]) => c[0])
    .find((p: unknown) => p instanceof ctor);
  if (!found) throw new Error(`${ctor.name} was not attached`);
  return found as Drawable;
}

function renderChart(props: Partial<ComponentProps<typeof AssetPriceChart>> = {}) {
  return renderWithClient(
    <AssetPriceChart
      slug="AAPL"
      initialChart={CHART}
      position={HELD}
      dividends={DIVIDENDS}
      {...props}
    />,
    makeTestQueryClient(),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AssetPriceChart", () => {
  it("draws a dashed cost line at averageCost when held, in price mode", async () => {
    renderChart();
    await waitFor(() =>
      expect(createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 150 })),
    );
  });

  it("draws no cost line when not held", async () => {
    renderChart({ position: { held: false } });
    await waitFor(() => expect(addSeries).toHaveBeenCalled());
    expect(createPriceLine).not.toHaveBeenCalled();
  });

  // Markers are a custom primitive rather than the built-in plugin, because the
  // plugin has no triangle — only arrowUp/arrowDown, which draw a head on a stem.
  it("attaches the trade-marker primitive, and the Trades toggle drives what it draws", async () => {
    renderChart();
    await waitFor(() => expect(attachPrimitive).toHaveBeenCalled());
    const trades = primitive(TradeMarkers);
    const { ctx, fills, target } = drawTarget(false);
    trades.paneViews()[0]!.renderer().draw(target);
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(fills).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: /trades/i }));
    ctx.moveTo.mockClear();
    trades.paneViews()[0]!.renderer().draw(target);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it("marks each ex-date in range on the baseline, on by default, behind a Dividends toggle", async () => {
    renderChart();
    await waitFor(() => expect(attachPrimitive).toHaveBeenCalled());
    const dividends = primitive(DividendMarkers);
    const toggle = screen.getByRole("button", { name: "Dividends" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    const on = drawTarget();
    dividends.paneViews()[0]!.renderer().draw(on.target);
    expect(on.ctx.arc).toHaveBeenCalledTimes(2); // halo + dot

    fireEvent.click(toggle);
    const off = drawTarget();
    dividends.paneViews()[0]!.renderer().draw(off.target);
    expect(off.ctx.arc).not.toHaveBeenCalled();
  });

  it("says a hovered ex-dividend amount is gross", async () => {
    const { container } = renderChart();
    await waitFor(() => expect(subscribeCrosshairMove).toHaveBeenCalled());
    const handlers = subscribeCrosshairMove.mock.calls.map(
      (c: unknown[]) => c[0] as (p: unknown) => void,
    );
    for (const h of handlers) {
      h({
        point: { x: 1, y: 1 },
        time: "2026-06-15",
        hoveredObjectId: "div-0",
        seriesData: new Map(),
      });
    }
    const text = container.textContent;
    expect(text).toContain("Ex-dividend");
    expect(text).toMatch(/\/ share, gross · paid Jun 30, 2026/);
  });

  it("detaches the crosshair primitive on teardown so its animation loop cannot outlive the chart", async () => {
    const { unmount } = renderChart();
    await waitFor(() => expect(attachPrimitive).toHaveBeenCalled());
    const crosshair = attachPrimitive.mock.calls
      .map((c: unknown[]) => c[0])
      .find((p: unknown) => p instanceof EasedCrosshair);
    expect(crosshair).toBeDefined();
    unmount();
    expect(detachPrimitive).toHaveBeenCalledWith(crosshair);
  });

  it("offers no Dividends toggle when no ex-date falls in range", async () => {
    renderChart({ dividends: [] });
    await waitFor(() => expect(addSeries).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Dividends" })).not.toBeInTheDocument();
  });

  it("tells the header how the selected range went, named", async () => {
    const onReadout = vi.fn<(r: ChartReadout | null) => void>();
    renderChart({ onReadout });
    await waitFor(() =>
      expect(onReadout).toHaveBeenCalledWith(expect.objectContaining({ rangePhrase: "past year" })),
    );
    const r = onReadout.mock.calls.at(-1)![0]!;
    expect(r.close).toBeNull();
    expect(r.price!.abs).toBe(10);
    expect(r.price!.pct).toBeCloseTo((10 / 170) * 100, 10);
  });

  it("is 240px tall below md and 320px from md", async () => {
    const { container } = renderChart();
    await waitFor(() => expect(addSeries).toHaveBeenCalled());
    const box = container.querySelector(".h-60");
    expect(box?.className).toContain("md:h-80");
  });
});

const BENCHMARKS = [
  { id: "sp500", name: "S&P 500 (TR)" },
  { id: "msci-world", name: "MSCI World (TR)" },
];

describe("AssetPriceChart — total return and compare", () => {
  it("switches the line to total return and reads it beside the price change", async () => {
    const onReadout = vi.fn<(r: ChartReadout | null) => void>();
    renderChart({ onReadout });
    fireEvent.click(await screen.findByRole("radio", { name: "Total return" }));
    await waitFor(() =>
      expect(onReadout.mock.calls.at(-1)![0]!.totalReturnPct).toBeCloseTo(
        ((180 * (1 + 1 / 180)) / 170 - 1) * 100,
        10,
      ),
    );
    // The average cost is a price; the total-return line rebuilds without it.
    expect(createPriceLine).toHaveBeenCalledTimes(1);
  });

  it("compares on total return against a TR index in the holding's currency: forces TR, locks the control, hides the cost line", async () => {
    vi.mocked(api.getBenchmarks).mockResolvedValue(BENCHMARKS);
    vi.mocked(api.getBenchmarkSeries).mockResolvedValue({
      series: {
        id: "sp500",
        name: "S&P 500 (TR)",
        currency: "USD",
        bars: [
          { date: "2026-06-01", close: "100" },
          { date: "2026-07-01", close: "103" },
        ],
      },
      reason: null,
    });
    const onReadout = vi.fn<(r: ChartReadout | null) => void>();
    renderChart({ dividends: [], onReadout });
    await waitFor(() => expect(createPriceLine).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
    fireEvent.click(await screen.findByRole("radio", { name: "S&P 500 (TR)" }));

    await waitFor(() => expect(addSeries).toHaveBeenCalledWith("Line", expect.anything()));
    // Asked for in the holding's currency: the server converts, the client only rebases.
    expect(api.getBenchmarkSeries).toHaveBeenCalledWith("sp500", "2026-06-01", "2026-07-01", "USD");
    const tr = screen.getByRole("radio", { name: "Total return" });
    expect(tr).toHaveAttribute("aria-checked", "true");
    expect(tr).toBeDisabled();
    expect(screen.getByText("compared on total return")).toBeInTheDocument();
    expect(createPriceLine).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(onReadout.mock.calls.at(-1)![0]!.compare?.status).toBe("ready"));
    const r = onReadout.mock.calls.at(-1)![0]!;
    expect(r.compare!.name).toBe("S&P 500 (TR), in USD");
    expect(r.compare!.benchmarkPct).toBeCloseTo(3, 10);
    expect(r.compare!.youPct).toBeCloseTo((180 / 170 - 1) * 100, 10);
  });

  it("says a benchmark it can't fetch is unavailable and stays a single line", async () => {
    vi.mocked(api.getBenchmarks).mockResolvedValue(BENCHMARKS);
    vi.mocked(api.getBenchmarkSeries).mockResolvedValue({ series: null, reason: "no_series" });
    const onReadout = vi.fn<(r: ChartReadout | null) => void>();
    renderChart({ onReadout });

    fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
    fireEvent.click(await screen.findByRole("radio", { name: "S&P 500 (TR)" }));

    await waitFor(() =>
      expect(onReadout.mock.calls.at(-1)![0]!.compare).toMatchObject({
        status: "unavailable",
        reason: "S&P 500 (TR) unavailable",
      }),
    );
    expect(addSeries).not.toHaveBeenCalledWith("Line", expect.anything());
    expect(screen.getByRole("radio", { name: "Total return" })).not.toBeDisabled();
  });

  it("says the index is unavailable in the holding's currency when no rate covers the range start — never an unconverted line", async () => {
    vi.mocked(api.getBenchmarks).mockResolvedValue(BENCHMARKS);
    vi.mocked(api.getBenchmarkSeries).mockResolvedValue({ series: null, reason: "no_fx_rate" });
    const onReadout = vi.fn<(r: ChartReadout | null) => void>();
    renderChart({ onReadout });

    fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
    fireEvent.click(await screen.findByRole("radio", { name: "S&P 500 (TR)" }));

    await waitFor(() =>
      expect(onReadout.mock.calls.at(-1)![0]!.compare).toMatchObject({
        status: "unavailable",
        reason: "S&P 500 (TR) unavailable in USD",
      }),
    );
    expect(addSeries).not.toHaveBeenCalledWith("Line", expect.anything());
  });
});
