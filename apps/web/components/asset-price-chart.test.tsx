import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import type { AssetDividendsDTO, AssetPositionDTO } from "../lib/types";
import type { ChartReadout } from "../lib/asset-chart/readout";

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
