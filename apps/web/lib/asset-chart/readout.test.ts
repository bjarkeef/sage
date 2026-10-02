import { describe, it, expect } from "vitest";
import { buildChartModel, type ChartDividend } from "./model";
import { readoutAt } from "./readout";

const closes = [
  { date: "2026-03-02", close: 100 },
  { date: "2026-03-03", close: 98 },
  { date: "2026-03-04", close: 99 },
];
const dividends: ChartDividend[] = [
  { exDate: "2026-03-03", amountPerShare: "2.00", currency: "USD", paymentDate: null },
];
const SP500 = {
  name: "S&P 500 (TR)",
  bars: [
    { date: "2026-03-02", close: 50 },
    { date: "2026-03-04", close: 55 },
  ],
};
const ctx = { rangePhrase: "past year", currency: "USD", compare: null };
const priceModel = buildChartModel({
  closes,
  currency: "USD",
  dividends,
  mode: "price",
  benchmark: null,
});

describe("readoutAt", () => {
  it("reads the whole range to today when nothing is hovered", () => {
    expect(readoutAt(priceModel, null, ctx)).toEqual({
      close: null,
      date: null,
      currency: "USD",
      rangePhrase: "past year",
      price: { abs: -1, pct: -1 },
      totalReturnPct: null,
      compare: null,
    });
  });

  it("reads the hovered close and the change from range start to that day", () => {
    const r = readoutAt(priceModel, "2026-03-03", ctx);
    expect(r.close).toBe(98);
    expect(r.date).toBe("2026-03-03");
    expect(r.price).toEqual({ abs: -2, pct: -2 });
  });

  it("reads total return beside the price change in TR mode", () => {
    const m = buildChartModel({ closes, currency: "USD", dividends, mode: "tr", benchmark: null });
    const r = readoutAt(m, null, ctx);
    expect(r.totalReturnPct).toBeCloseTo((99 / 98 - 1) * 100, 10);
    expect(r.price!.pct).toBe(-1);
  });

  it("reads you and the benchmark at the hovered day when comparing", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends,
      mode: "price",
      benchmark: SP500,
    });
    const r = readoutAt(m, "2026-03-04", {
      ...ctx,
      compare: { name: "S&P 500 (TR)", status: "ready", reason: null },
    });
    expect(r.compare!.status).toBe("ready");
    expect(r.compare!.youPct).toBeCloseTo((99 / 98 - 1) * 100, 10);
    expect(r.compare!.benchmarkPct).toBeCloseTo(10, 10);
    expect(r.totalReturnPct).toBeNull();
  });

  it("says the benchmark is unavailable when it arrived but could not be drawn", () => {
    const r = readoutAt(priceModel, null, {
      ...ctx,
      compare: { name: "S&P 500 (TR)", status: "ready", reason: null },
    });
    expect(r.compare).toMatchObject({
      status: "unavailable",
      reason: "S&P 500 (TR) unavailable",
      youPct: null,
    });
  });

  it("explains a comparison blocked by total return being unavailable", () => {
    const m = buildChartModel({
      closes,
      currency: "USD",
      dividends: [{ ...dividends[0]!, currency: "GBP" }],
      mode: "price",
      benchmark: SP500,
    });
    const r = readoutAt(m, null, {
      ...ctx,
      compare: { name: "S&P 500 (TR)", status: "ready", reason: null },
    });
    expect(r.compare!.status).toBe("unavailable");
    expect(r.compare!.reason).toContain("GBP");
  });

  it("passes a failed fetch and a pending one through as they are", () => {
    expect(
      readoutAt(priceModel, null, {
        ...ctx,
        compare: {
          name: "S&P 500 (TR)",
          status: "unavailable",
          reason: "S&P 500 (TR) unavailable",
        },
      }).compare!.reason,
    ).toBe("S&P 500 (TR) unavailable");
    expect(
      readoutAt(priceModel, null, {
        ...ctx,
        compare: { name: "S&P 500 (TR)", status: "pending", reason: null },
      }).compare,
    ).toMatchObject({ status: "pending", youPct: null, benchmarkPct: null });
  });
});
