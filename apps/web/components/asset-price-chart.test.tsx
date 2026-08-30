import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import type { AssetPositionDTO } from "../lib/types";

const { createPriceLine, setMarkers } = vi.hoisted(() => ({
  createPriceLine: vi.fn(),
  setMarkers: vi.fn(),
}));

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dashed: 2 };
  const ColorType = { Solid: "solid" };
  const series = { setData: vi.fn(), createPriceLine };
  const chartStub = {
    addSeries: vi.fn(() => series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    createSeriesMarkers: vi.fn(() => ({ setMarkers })),
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

  it("renders markers on by default (≤15) and hides them on toggle", async () => {
    renderWithClient(
      <AssetPriceChart slug="AAPL" initialChart={CHART} position={HELD} />,
      makeTestQueryClient(),
    );
    await waitFor(() =>
      expect(setMarkers).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)])),
    );
    fireEvent.click(screen.getByRole("button", { name: /trades/i }));
    await waitFor(() => expect(setMarkers).toHaveBeenLastCalledWith([]));
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
