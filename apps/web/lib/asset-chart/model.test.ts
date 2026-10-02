import { describe, it, expect } from "vitest";
import { buildChartModel, type ChartDividend } from "./model";

const closes = [
  { date: "2026-03-02", close: 100 },
  { date: "2026-03-03", close: 98 },
  { date: "2026-03-04", close: 99 },
];
const div = (exDate: string, amount = "2.00", currency = "USD"): ChartDividend => ({
  exDate,
  amountPerShare: amount,
  currency,
  paymentDate: null,
});
const SP500 = {
  name: "S&P 500 (TR)",
  bars: [
    { date: "2026-03-02", close: 50 },
    { date: "2026-03-04", close: 55 },
  ],
};

describe("buildChartModel", () => {
  it("draws the price line in price mode and takes its direction from how the range ended", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-03-03")],
      mode: "price",
      benchmark: null,
    });
    expect(m.axis).toBe("price");
    expect(m.lineMode).toBe("price");
    expect(m.holding.map((p) => p.value)).toEqual([100, 98, 99]);
    expect(m.direction).toBe("down");
  });

  it("draws total return in TR mode, and its direction is total return's", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-03-03")],
      mode: "tr",
      benchmark: null,
    });
    expect(m.lineMode).toBe("tr");
    expect(m.holding[1]!.value).toBeCloseTo(100, 10);
    expect(m.holding[2]!.value).toBeCloseTo((100 * 99) / 98, 10);
    expect(m.direction).toBe("up");
  });

  it("says why total return is unavailable when dividends are in another currency, and stays on price", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-03-03", "2.00", "GBP")],
      mode: "tr",
      benchmark: null,
    });
    expect(m.lineMode).toBe("price");
    expect(m.totalReturn).toBeNull();
    expect(m.trUnavailable).toContain("GBP");
  });

  it("forces total return on a percent axis when a benchmark is on", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-03-03")],
      mode: "price",
      benchmark: SP500,
    });
    expect(m.axis).toBe("percent");
    expect(m.lineMode).toBe("tr");
    expect(m.benchmark![1]!.value).toBe(0);
    expect(m.benchmark![2]!.value).toBeCloseTo(10, 10);
    expect(m.holding[2]!.value).toBeCloseTo((99 / 98 - 1) * 100, 10);
  });

  it("takes a comparison's direction from the drawn line, which starts where the benchmark does", () => {
    // Full range 100 → 95 is down; from the benchmark's first bar (90 → 95) it is up.
    const m = buildChartModel({
      closes: [
        { date: "2026-03-02", close: 100 },
        { date: "2026-03-03", close: 90 },
        { date: "2026-03-04", close: 95 },
      ],
      currency: "USD",
      dividends: [],
      mode: "price",
      benchmark: {
        name: "S&P 500 (TR)",
        bars: [
          { date: "2026-03-03", close: 50 },
          { date: "2026-03-04", close: 55 },
        ],
      },
    });
    expect(m.axis).toBe("percent");
    expect(m.holding[0]!.time).toBe("2026-03-03");
    expect(m.holding.at(-1)!.value).toBeGreaterThan(0);
    expect(m.direction).toBe("up");
  });

  it("never compares a price line: without total return there is no benchmark", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-03-03", "2.00", "GBP")],
      mode: "price",
      benchmark: SP500,
    });
    expect(m.axis).toBe("price");
    expect(m.benchmark).toBeNull();
  });

  it("keeps a single line when the benchmark has nothing in range", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [],
      mode: "price",
      benchmark: { name: "S&P 500 (TR)", bars: [{ date: "2026-04-01", close: 60 }] },
    });
    expect(m.axis).toBe("price");
    expect(m.benchmark).toBeNull();
  });

  it("lists the dividends whose ex-date falls in the range, as numbers", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [div("2026-02-01"), div("2026-03-03", "0.6749"), div("2026-04-01")],
      mode: "price",
      benchmark: null,
    });
    expect(m.dividendsInRange).toEqual([
      { exDate: "2026-03-03", amountPerShare: 0.6749, currency: "USD", paymentDate: null },
    ]);
  });
});
