import { vi } from "vitest";

/**
 * The lightweight-charts test double, in one place.
 *
 * Two suites mock this library, and the double has to carry every method
 * `PortfolioChart` calls. When it does not, the missing method throws inside a
 * render effect and every test in that file fails with the same message — which
 * reads like a component regression rather than a stale stub, and cost real time
 * twice: once for `attachPrimitive`, once for the entrance's price-scale calls.
 * Adding a chart API to the component now means adding it here, once.
 *
 * Deliberately not a faithful fake. It records calls and returns chainable
 * objects; it draws nothing, because jsdom lays out no canvas. Anything about
 * the drawing itself is tested through the pure helpers instead — see
 * `components/charts/gain-band.test.ts`.
 */
export function lightweightChartsStub() {
  const seriesStub = {
    setData: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    priceScale: vi.fn(() => ({ setAutoScale: vi.fn(), applyOptions: vi.fn() })),
    priceToCoordinate: vi.fn(() => 0),
  };
  const chartStub = {
    addSeries: vi.fn(() => seriesStub),
    timeScale: vi.fn(() => ({
      fitContent: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => null),
      setVisibleLogicalRange: vi.fn(),
      timeToCoordinate: vi.fn(() => 0),
    })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    AreaSeries: "Area",
    LineSeries: "Line",
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    ColorType: { Solid: "solid", VerticalGradient: "gradient" },
  };
}
