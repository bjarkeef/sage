import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import type { AssetPositionDTO } from "../lib/types";

const { createPriceLine, attachPrimitive } = vi.hoisted(() => ({
  createPriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
}));

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dashed: 2 };
  const ColorType = { Solid: "solid" };
  const series = {
    setData: vi.fn(),
    createPriceLine,
    attachPrimitive,
    priceToCoordinate: vi.fn(() => 17),
  };
  const chartStub = {
    addSeries: vi.fn(() => series),
    // timeToCoordinate/priceToCoordinate are what the marker primitive uses to
    // place a triangle; without them the draw throws rather than drawing.
    timeScale: vi.fn(() => ({
      fitContent: vi.fn(),
      timeToCoordinate: vi.fn(() => 42),
    })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),

    AreaSeries: "Area",
    LineStyle,
    ColorType,
  };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../lib/api", () => ({ getAssetChart: vi.fn() }));

import { AssetPriceChart } from "./asset-price-chart";

const CHART = [
  { date: "2026-06-01", close: { amount: "170", currency: "USD" } },
  { date: "2026-07-01", close: { amount: "180", currency: "USD" } },
];
const HELD: AssetPositionDTO = {
  held: true,
  averageCost: { amount: "150", currency: "USD" },
  trades: [
    { tradeDate: "2026-06-02", type: "buy", price: "168", quantity: "10" },
    { tradeDate: "2026-06-20", type: "sell", price: "175", quantity: "4" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("AssetPriceChart cost line + markers", () => {
  it("draws a dashed cost line at averageCost when held", async () => {
    renderWithClient(
      <AssetPriceChart slug="AAPL" initialChart={CHART} position={HELD} />,
      makeTestQueryClient(),
    );
    await waitFor(() =>
      expect(createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 150 })),
    );
  });

  // Markers are a custom primitive rather than the built-in plugin, because the
  // plugin has no triangle — only arrowUp/arrowDown, which draw a head on a
  // stem and do not match the ▲ / ▼ in the legend and tooltip.
  it("attaches the trade-marker primitive, and the toggle drives what it draws", async () => {
    renderWithClient(
      <AssetPriceChart slug="AAPL" initialChart={CHART} position={HELD} />,
      makeTestQueryClient(),
    );
    await waitFor(() => expect(attachPrimitive).toHaveBeenCalledTimes(1));

    const primitive = attachPrimitive.mock.calls[0]![0] as {
      paneViews: () => { renderer: () => { draw: (t: unknown) => void } }[];
      hitTest: (x: number, y: number) => unknown;
    };

    // Drive a real draw through a stub target and capture the triangles.
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
        fn({ context: ctx, horizontalPixelRatio: 1, verticalPixelRatio: 1 }),
    };
    primitive.paneViews()[0]!.renderer().draw(target);

    // Two trades, each a halo fill then a triangle fill.
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(fills).toHaveLength(4);

    // With trades hidden, the primitive draws nothing at all.
    fireEvent.click(screen.getByRole("button", { name: /trades/i }));
    ctx.moveTo.mockClear();
    primitive.paneViews()[0]!.renderer().draw(target);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it("draws no cost line when not held", async () => {
    renderWithClient(
      <AssetPriceChart slug="AAPL" initialChart={CHART} position={{ held: false }} />,
      makeTestQueryClient(),
    );
    await waitFor(() => expect(screen.queryByText(/No price data/)).not.toBeInTheDocument());
    expect(createPriceLine).not.toHaveBeenCalled();
  });
});
