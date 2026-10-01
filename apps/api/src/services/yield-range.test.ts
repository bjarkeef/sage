import { describe, it, expect } from "vitest";
import type { DividendHistoryRow } from "@sage/core";
import { computeYieldRange5y, MIN_YIELD_SAMPLES } from "./yield-range";

// Injected "today"; every date is built from it.
const TODAY = "2026-06-15";
const Y = Number(TODAY.slice(0, 4));

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A close on every day from `fromIso` to TODAY. Days 28–31 close at 50 and
 *  the rest at 100, so a month-end sample and a mid-month sample disagree by 2×. */
function dailyCloses(fromIso: string, currency = "USD") {
  const out: { date: string; close: number; currency: string }[] = [];
  for (let d = fromIso; d <= TODAY; d = shift(d, 1)) {
    out.push({ date: d, close: Number(d.slice(8, 10)) >= 28 ? 50 : 100, currency });
  }
  return out;
}

/** 0.75 a quarter on the 15th of Mar/Jun/Sep/Dec from `firstYear`-06-15 to
 *  TODAY. Any 365-day window holds exactly four, so TTM is exactly 3.00. */
function quarterly(firstYear: number, currency = "USD"): DividendHistoryRow[] {
  const out: DividendHistoryRow[] = [];
  for (let y = firstYear; y <= Y; y++) {
    for (const m of ["03", "06", "09", "12"]) {
      const exDate = `${y}-${m}-15`;
      if (exDate < `${firstYear}-06-15` || exDate > TODAY) continue;
      out.push({ symbol: "KO", exDate, amountPerShare: "0.75", currency });
    }
  }
  return out;
}

describe("computeYieldRange5y", () => {
  it("returns null with fewer than two years of month-end samples", () => {
    const r = computeYieldRange5y({
      closes: dailyCloses(shift(TODAY, -540)),
      dividends: quarterly(Y - 4),
      todayIso: TODAY,
      currentYield: 0.06,
    });
    expect(MIN_YIELD_SAMPLES).toBe(24);
    expect(r).toBeNull();
  });

  it("samples the close at each month-end: trailing 3.00 over a 50 close is 6%", () => {
    const r = computeYieldRange5y({
      closes: dailyCloses(`${Y - 5}-06-15`),
      dividends: quarterly(Y - 4),
      todayIso: TODAY,
      currentYield: 0.06,
    });
    // A mid-month sample would read 3.00 / 100 = 3%.
    expect(r).not.toBeNull();
    expect(r!.low).toBeCloseTo(0.06, 6);
    expect(r!.high).toBeCloseTo(0.06, 6);
  });

  it("skips month-ends before the first full trailing year of dividends", () => {
    // Closes reach back five years but dividends only four: without the skip the
    // first year of month-ends reads 0% and becomes the low.
    const r = computeYieldRange5y({
      closes: dailyCloses(`${Y - 5}-06-15`),
      dividends: quarterly(Y - 4),
      todayIso: TODAY,
      currentYield: null,
    });
    expect(r!.low).toBeGreaterThan(0.05);
  });

  it("skips a month whose trailing dividends are in another currency than its close", () => {
    const divs = quarterly(Y - 4);
    // The March payment of this year: the last three month-ends' windows hold it.
    const i = divs.length - 2;
    divs[i] = { ...divs[i]!, currency: "GBP" };
    const r = computeYieldRange5y({
      closes: dailyCloses(`${Y - 5}-06-15`),
      dividends: divs,
      todayIso: TODAY,
      currentYield: null,
    });
    // Summing only the USD rows would read 2.25 / 50 = 4.5% for those months.
    expect(r!.low).toBeCloseTo(0.06, 6);
  });

  it("passes the current yield through untouched: the API's TTM ÷ live price is its one producer", () => {
    const r = computeYieldRange5y({
      closes: dailyCloses(`${Y - 5}-06-15`),
      dividends: quarterly(Y - 4),
      todayIso: TODAY,
      currentYield: 0.0612,
    });
    expect(r!.current).toBe(0.0612);
  });

  it("returns null for a holding that has never paid", () => {
    expect(
      computeYieldRange5y({
        closes: dailyCloses(`${Y - 5}-06-15`),
        dividends: [],
        todayIso: TODAY,
        currentYield: null,
      }),
    ).toBeNull();
  });
});
