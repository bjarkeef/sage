import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import type { PositionTransaction } from "./positions";
import {
  computeRetroactiveIncome,
  computeDividendCAGR,
  computeYieldOnCost,
  dedupeDividends,
  frequencyFromPeriod,
  inferFrequency,
  excludeSpecialDividends,
  regularDividendAmount,
  projectDividendSchedule,
  projectionHorizonIso,
  classifyDividendTrend,
  clampDividendGrowth,
  type DividendHistoryRow,
} from "./dividends";

function buy(
  symbol: string,
  qty: string,
  price: string,
  date: string,
  ccy = "USD",
): PositionTransaction {
  return {
    symbol,
    type: "buy",
    quantity: new Decimal(qty),
    price: Money.of(price, ccy),
    tradeDate: new Date(`${date}T00:00:00Z`),
  };
}
function sell(
  symbol: string,
  qty: string,
  price: string,
  date: string,
  ccy = "USD",
): PositionTransaction {
  return {
    symbol,
    type: "sell",
    quantity: new Decimal(qty),
    price: Money.of(price, ccy),
    tradeDate: new Date(`${date}T00:00:00Z`),
  };
}
function split(symbol: string, multiplier: string, date: string, ccy = "USD"): PositionTransaction {
  return {
    symbol,
    type: "split",
    quantity: new Decimal(multiplier),
    price: Money.of("0", ccy),
    tradeDate: new Date(`${date}T00:00:00Z`),
  };
}

function div(symbol: string, exDate: string, amount: string, ccy = "USD"): DividendHistoryRow {
  return { symbol, exDate, amountPerShare: amount, currency: ccy };
}

describe("computeRetroactiveIncome", () => {
  it("returns income for dividends while holding shares", () => {
    const txs = [buy("AAPL", "10", "100", "2025-01-01")];
    const divs = [div("AAPL", "2025-06-15", "0.25")];
    const result = computeRetroactiveIncome(txs, divs);
    expect(result).toEqual([
      {
        symbol: "AAPL",
        exDate: "2025-06-15",
        paymentDate: null,
        paymentDateEstimated: false,
        amountPerShare: "0.25",
        sharesHeld: "10",
        income: "2.5",
        currency: "USD",
      },
    ]);
  });

  it("returns nothing for dividends before any purchase", () => {
    const txs = [buy("AAPL", "10", "100", "2025-06-20")];
    const divs = [div("AAPL", "2025-06-15", "0.25")];
    expect(computeRetroactiveIncome(txs, divs)).toEqual([]);
  });

  it("uses shares held at ex-date after partial sell", () => {
    const txs = [buy("AAPL", "10", "100", "2025-01-01"), sell("AAPL", "6", "120", "2025-05-01")];
    const divs = [div("AAPL", "2025-06-15", "0.50")];
    const result = computeRetroactiveIncome(txs, divs);
    expect(result).toEqual([
      {
        symbol: "AAPL",
        exDate: "2025-06-15",
        paymentDate: null,
        paymentDateEstimated: false,
        amountPerShare: "0.50",
        sharesHeld: "4",
        income: "2",
        currency: "USD",
      },
    ]);
  });

  it("returns nothing for a fully-sold position", () => {
    const txs = [buy("AAPL", "10", "100", "2025-01-01"), sell("AAPL", "10", "120", "2025-03-01")];
    const divs = [div("AAPL", "2025-06-15", "0.25")];
    expect(computeRetroactiveIncome(txs, divs)).toEqual([]);
  });

  it("handles multiple dividends across multiple symbols", () => {
    const txs = [buy("AAPL", "10", "100", "2025-01-01"), buy("MSFT", "5", "200", "2025-01-01")];
    const divs = [
      div("AAPL", "2025-03-15", "0.25"),
      div("AAPL", "2025-06-15", "0.25"),
      div("MSFT", "2025-06-10", "0.75"),
    ];
    const result = computeRetroactiveIncome(txs, divs);
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.symbol === "MSFT")!.income).toBe("3.75");
  });

  it("accounts for stock splits when computing shares held", () => {
    const txs = [buy("AAPL", "10", "600", "2025-01-01"), split("AAPL", "4", "2025-05-01")];
    const divs = [div("AAPL", "2025-06-15", "0.25")];
    const result = computeRetroactiveIncome(txs, divs);
    // After 4:1 split, 10 shares become 40
    expect(result[0]!.sharesHeld).toBe("40");
    expect(result[0]!.income).toBe("10");
  });

  it("returns empty for no dividend history", () => {
    const txs = [buy("AAPL", "10", "100", "2025-01-01")];
    expect(computeRetroactiveIncome(txs, [])).toEqual([]);
  });

  it("returns empty for no transactions", () => {
    const divs = [div("AAPL", "2025-06-15", "0.25")];
    expect(computeRetroactiveIncome([], divs)).toEqual([]);
  });

  it("passes payment date fields through to retroactive income rows", () => {
    const txs: PositionTransaction[] = [
      {
        symbol: "O",
        type: "buy",
        quantity: new Decimal(10),
        price: Money.of("50", "USD"),
        tradeDate: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    const history: DividendHistoryRow[] = [
      {
        symbol: "O",
        exDate: "2026-06-30",
        amountPerShare: "0.271",
        currency: "USD",
        paymentDate: "2026-07-15",
        paymentDateEstimated: false,
      },
    ];
    const rows = computeRetroactiveIncome(txs, history);
    expect(rows[0]).toMatchObject({ paymentDate: "2026-07-15", paymentDateEstimated: false });
  });

  it("defaults paymentDate to null and estimated to false when absent", () => {
    const txs: PositionTransaction[] = [
      {
        symbol: "O",
        type: "buy",
        quantity: new Decimal(10),
        price: Money.of("50", "USD"),
        tradeDate: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    const rows = computeRetroactiveIncome(txs, [
      { symbol: "O", exDate: "2026-06-30", amountPerShare: "0.271", currency: "USD" },
    ]);
    expect(rows[0]).toMatchObject({ paymentDate: null, paymentDateEstimated: false });
  });
});

describe("dedupeDividends", () => {
  it("collapses near-duplicate ex-dates from different providers, keeping the latest", () => {
    // An annual payer's single dividend, reported twice 3 days apart. Both
    // amounts are real-shaped: providers disagree in the 4th decimal too.
    const rows = [div("HUDSON", "2026-05-29", "0.86917"), div("HUDSON", "2026-06-01", "0.8736")];
    const result = dedupeDividends(rows);
    expect(result).toEqual([div("HUDSON", "2026-06-01", "0.8736")]);
  });

  it("keeps genuinely distinct dividends spaced a normal cadence apart", () => {
    const rows = [
      div("O", "2026-04-01", "0.27"),
      div("O", "2026-05-01", "0.27"),
      div("O", "2026-06-01", "0.27"),
    ];
    expect(dedupeDividends(rows)).toHaveLength(3);
  });

  it("dedupes each symbol independently", () => {
    const rows = [
      div("HUDSON", "2026-06-01", "0.87"),
      div("RHEIN.DE", "2026-06-02", "2.92", "EUR"),
    ];
    expect(dedupeDividends(rows)).toHaveLength(2);
  });

  it("collapses cross-currency near-duplicates within the widened 12-day window", () => {
    // A Stockholm-listed monthly payer: the same payment reported by two
    // providers, once in EUR and once in SEK, 8 days apart — just past the old
    // 7-day window. This shape is why the window is 12 days.
    const rows = [
      div("SVEAFAST.ST", "2023-09-21", "0.7712", "EUR"),
      div("SVEAFAST.ST", "2023-09-29", "0.8826232", "SEK"),
    ];
    const result = dedupeDividends(rows);
    expect(result).toEqual([div("SVEAFAST.ST", "2023-09-29", "0.8826232", "SEK")]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeDividends([])).toEqual([]);
  });
});

describe("computeYieldOnCost", () => {
  // Trailing window is (asOf - 1y, asOf]. asOf fixed for deterministic boundaries.
  const asOf = new Date("2026-06-30T00:00:00Z");

  it("sums the trailing 12 months of dividends over average cost, in the cost currency", () => {
    const cost = Money.of("100", "USD");
    const divs = [
      div("AAPL", "2025-09-15", "0.5"),
      div("AAPL", "2025-12-15", "0.5"),
      div("AAPL", "2026-03-15", "0.5"),
      div("AAPL", "2026-06-15", "0.5"),
    ];
    const result = computeYieldOnCost(divs, cost, asOf);
    // 2.00 annual / 100 cost = 0.02 (2%)
    expect(result?.toFixed(4)).toBe("0.0200");
  });

  it("excludes dividends with a future ex-date", () => {
    const cost = Money.of("100", "USD");
    const divs = [div("AAPL", "2026-06-15", "0.5"), div("AAPL", "2026-12-15", "0.5")];
    const result = computeYieldOnCost(divs, cost, asOf);
    // Only the past dividend counts: 0.5 / 100 = 0.005
    expect(result?.toFixed(4)).toBe("0.0050");
  });

  it("excludes dividends older than 12 months", () => {
    const cost = Money.of("100", "USD");
    const divs = [div("AAPL", "2025-01-01", "0.5"), div("AAPL", "2026-06-15", "0.5")];
    const result = computeYieldOnCost(divs, cost, asOf);
    expect(result?.toFixed(4)).toBe("0.0050");
  });

  it("returns null when a dividend currency differs from cost and no converter is given", () => {
    const cost = Money.of("100", "USD");
    const divs = [div("ALBION", "2026-06-15", "0.5", "EUR")];
    // The buggy inline calc divided EUR amounts by a USD cost; refuse instead.
    expect(computeYieldOnCost(divs, cost, asOf)).toBeNull();
  });

  it("converts foreign-currency dividends with the provided converter", () => {
    const cost = Money.of("100", "USD");
    const divs = [div("ALBION", "2026-06-15", "1", "EUR")];
    // 1 EUR -> 1.1 USD; 1.1 / 100 = 0.011
    const convert = (amount: Decimal, from: string, to: string) =>
      from === "EUR" && to === "USD" ? amount.times("1.1") : null;
    expect(computeYieldOnCost(divs, cost, asOf, convert)?.toFixed(4)).toBe("0.0110");
  });

  it("counts a payment reported twice (near-duplicate ex-dates) only once", () => {
    const cost = Money.of("50", "USD");
    const divs = [div("HUDSON", "2026-05-29", "0.86917"), div("HUDSON", "2026-06-01", "0.8736")];
    // One annual payment ~0.87, not ~1.74: 0.8736 / 50 = 0.017472
    expect(computeYieldOnCost(divs, cost, asOf)?.toFixed(4)).toBe("0.0175");
  });

  it("returns null when average cost is zero", () => {
    const cost = Money.of("0", "USD");
    const divs = [div("AAPL", "2026-06-15", "0.5")];
    expect(computeYieldOnCost(divs, cost, asOf)).toBeNull();
  });

  it("returns null when there are no qualifying dividends", () => {
    const cost = Money.of("100", "USD");
    expect(computeYieldOnCost([], cost, asOf)).toBeNull();
  });
});

describe("projectDividendSchedule", () => {
  const asOf = new Date("2026-07-03T00:00:00Z");
  const monthly = (exDate: string, amount = "0.27"): DividendHistoryRow => ({
    symbol: "O",
    exDate,
    amountPerShare: amount,
    currency: "USD",
    paymentDate: null,
    period: "Monthly",
  });

  it("announced rows come through verbatim as high-confidence announced", () => {
    const rows = projectDividendSchedule({
      symbol: "O",
      quantity: new Decimal(10),
      history: [monthly("2026-05-29"), monthly("2026-06-30")],
      announced: [
        {
          exDate: "2026-07-31",
          paymentDate: "2026-08-14",
          paymentDateEstimated: false,
          amountPerShare: "0.28",
          currency: "USD",
        },
      ],
      asOf,
    });
    const announced = rows.filter((r) => r.kind === "announced");
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({
      exDate: "2026-07-31",
      paymentDate: "2026-08-14",
      income: "2.80",
      confidence: "high",
    });
  });

  it("generates a monthly schedule after the last announced date, within 12 months", () => {
    const history = [
      monthly("2026-02-27"),
      monthly("2026-03-31"),
      monthly("2026-04-30"),
      monthly("2026-05-29"),
      monthly("2026-06-30"),
    ];
    const rows = projectDividendSchedule({
      symbol: "O",
      quantity: new Decimal(10),
      history,
      announced: [
        {
          exDate: "2026-07-31",
          paymentDate: "2026-08-14",
          paymentDateEstimated: false,
          amountPerShare: "0.28",
          currency: "USD",
        },
      ],
      asOf,
    });
    const projected = rows.filter((r) => r.kind === "projected");
    // ~11 more monthly events after the announced July one, all inside the window
    expect(projected.length).toBeGreaterThanOrEqual(10);
    expect(projected.length).toBeLessThanOrEqual(11);
    expect(projected.every((r) => r.exDate > "2026-07-31")).toBe(true);
    expect(projected.every((r) => r.exDate <= "2027-07-03")).toBe(true);
    expect(projected.every((r) => r.paymentDateEstimated)).toBe(true);
    expect(projected[0]!.amountPerShare).toBe("0.27"); // median of last three
  });

  it("falls back to repeat-last-year for irregular payers, low confidence", () => {
    const history = [
      { symbol: "X", exDate: "2025-09-15", amountPerShare: "1.00", currency: "USD" },
      { symbol: "X", exDate: "2025-10-01", amountPerShare: "0.20", currency: "USD" },
      { symbol: "X", exDate: "2026-03-20", amountPerShare: "0.65", currency: "USD" },
    ];
    const rows = projectDividendSchedule({
      symbol: "X",
      quantity: new Decimal(5),
      history,
      announced: [],
      asOf,
    });
    expect(rows.every((r) => r.kind === "projected" && r.confidence === "low")).toBe(true);
    expect(rows.map((r) => r.exDate)).toEqual(["2026-09-15", "2026-10-01", "2027-03-20"]);
  });

  it("projects nothing beyond announced when the payer went quiet", () => {
    const rows = projectDividendSchedule({
      symbol: "Y",
      quantity: new Decimal(5),
      history: [{ symbol: "Y", exDate: "2024-01-10", amountPerShare: "1.00", currency: "USD" }],
      announced: [],
      asOf,
    });
    expect(rows).toEqual([]);
  });

  it("a far-future announced date (beyond the 12-month window) does not suppress in-window projections", () => {
    const history = [
      monthly("2026-02-27"),
      monthly("2026-03-31"),
      monthly("2026-04-30"),
      monthly("2026-05-29"),
      monthly("2026-06-30"),
    ];
    const rows = projectDividendSchedule({
      symbol: "O",
      quantity: new Decimal(10),
      history,
      // ~14 months out from asOf (2026-07-03) — beyond windowEndIso (2027-07-03)
      announced: [
        {
          exDate: "2027-09-01",
          paymentDate: "2027-09-15",
          paymentDateEstimated: false,
          amountPerShare: "0.30",
          currency: "USD",
        },
      ],
      asOf,
    });
    // The far-future announced row must not appear in output (it's outside the window)...
    expect(rows.some((r) => r.exDate === "2027-09-01")).toBe(false);
    // ...but monthly projections within the window must still be generated.
    const projected = rows.filter((r) => r.kind === "projected");
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.every((r) => r.exDate > "2026-06-30")).toBe(true);
    expect(projected.every((r) => r.exDate <= "2027-07-03")).toBe(true);
  });
});

describe("computeDividendCAGR", () => {
  it("computes 5-year CAGR from quarterly dividends with growth", () => {
    // Year 1 (5 years ago): 4 quarterly divs of $0.20 = $0.80/year
    // Year 5 (current): 4 quarterly divs of $0.25 = $1.00/year
    // CAGR = (1.00/0.80)^(1/4) - 1 ≈ 0.0574
    const divs: DividendHistoryRow[] = [];
    for (let y = 0; y < 5; y++) {
      const year = 2021 + y;
      const amount = (0.2 + y * 0.0125).toFixed(4);
      for (const m of ["03", "06", "09", "12"]) {
        divs.push(div("AAPL", `${year}-${m}-15`, amount));
      }
    }
    const result = computeDividendCAGR(divs, 5, new Date("2026-06-01T00:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeGreaterThan(0);
    expect(result!.toNumber()).toBeLessThan(0.2);
  });

  it("returns null with fewer than 2 complete years of data", () => {
    const divs = [div("AAPL", "2026-03-15", "0.25"), div("AAPL", "2026-06-15", "0.25")];
    const result = computeDividendCAGR(divs, 5, new Date("2026-06-01T00:00:00Z"));
    expect(result).toBeNull();
  });

  it("returns null for empty dividend history", () => {
    expect(computeDividendCAGR([], 5, new Date("2026-06-01T00:00:00Z"))).toBeNull();
  });

  it("returns zero CAGR when dividends are flat", () => {
    const divs: DividendHistoryRow[] = [];
    for (let y = 0; y < 5; y++) {
      const year = 2021 + y;
      for (const m of ["03", "06", "09", "12"]) {
        divs.push(div("AAPL", `${year}-${m}-15`, "0.25"));
      }
    }
    const result = computeDividendCAGR(divs, 5, new Date("2026-06-01T00:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0, 4);
  });

  it("handles a single symbol from a mixed-symbol history", () => {
    const divs = [
      div("AAPL", "2021-06-15", "0.20"),
      div("MSFT", "2021-06-15", "0.50"),
      div("AAPL", "2025-06-15", "0.30"),
      div("MSFT", "2025-06-15", "0.70"),
    ];
    // computeDividendCAGR filters to a single symbol's dividends
    // But spec says it takes all dividendHistory for a symbol — caller filters
    // So this test passes all divs; the function sums by year regardless of symbol
    // Actually, the function is called per-symbol by the API endpoint
    // Let's test with single-symbol data
    const aaplDivs = divs.filter((d) => d.symbol === "AAPL");
    const result = computeDividendCAGR(aaplDivs, 5, new Date("2026-06-01T00:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeGreaterThan(0);
  });

  it("returns null when the 5-year window spans a currency change", () => {
    // A genuine multi-year currency split: paid in SEK through 2023, then
    // redenominated to EUR from 2026 — not a provider duplicate.
    const divs: DividendHistoryRow[] = [
      div("SVEAFAST.ST", "2022-01-01", "0.80", "SEK"),
      div("SVEAFAST.ST", "2022-07-01", "0.80", "SEK"),
      div("SVEAFAST.ST", "2023-01-01", "0.85", "SEK"),
      div("SVEAFAST.ST", "2023-07-01", "0.85", "SEK"),
      div("SVEAFAST.ST", "2026-01-01", "0.08", "EUR"),
      div("SVEAFAST.ST", "2026-06-01", "0.08", "EUR"),
    ];
    const result = computeDividendCAGR(divs, 5, new Date("2026-07-20T00:00:00Z"));
    expect(result).toBeNull();
  });

  it("computes normally when every payment in the window shares one currency", () => {
    const divs: DividendHistoryRow[] = [
      div("ALBION", "2022-01-01", "0.10", "EUR"),
      div("ALBION", "2022-07-01", "0.10", "EUR"),
      div("ALBION", "2026-01-01", "0.12", "EUR"),
      div("ALBION", "2026-06-01", "0.12", "EUR"),
    ];
    const result = computeDividendCAGR(divs, 5, new Date("2026-07-20T00:00:00Z"));
    expect(result).not.toBeNull();
  });

  it("anchors CAGR on the current payout cadence after a frequency change", () => {
    const asOf = new Date("2026-07-20T00:00:00Z");
    const divs: DividendHistoryRow[] = [
      // Most recent year (quarterly): 4 x 0.30 = 1.20
      div("DUOMO", "2025-10-01", "0.30"),
      div("DUOMO", "2026-01-01", "0.30"),
      div("DUOMO", "2026-04-01", "0.30"),
      div("DUOMO", "2026-07-01", "0.30"),
      // Prior year (also quarterly): 4 x 0.25 = 1.00
      div("DUOMO", "2024-10-01", "0.25"),
      div("DUOMO", "2025-01-01", "0.25"),
      div("DUOMO", "2025-04-01", "0.25"),
      div("DUOMO", "2025-07-01", "0.25"),
      // Three older years, back when DUOMO paid semiannually: 2 x 0.50 = 1.00
      // each. A stale-modal heuristic would anchor on these (count=2 appears
      // 3 times vs count=4's 2 times) and report 0% growth between two of
      // these instead of using the two recent quarterly years.
      div("DUOMO", "2023-10-01", "0.50"),
      div("DUOMO", "2024-04-01", "0.50"),
      div("DUOMO", "2022-10-01", "0.50"),
      div("DUOMO", "2023-04-01", "0.50"),
      div("DUOMO", "2021-10-01", "0.50"),
      div("DUOMO", "2022-04-01", "0.50"),
    ];
    const result = computeDividendCAGR(divs, 5, asOf);
    // Anchored on the current (quarterly) cadence: 1.20 / 1.00 - 1 = 20%,
    // comparing the two most recent years, not the stale semiannual ones.
    expect(result?.toFixed(4)).toBe("0.2000");
  });
});

describe("frequencyFromPeriod", () => {
  it("maps EODHD period strings", () => {
    expect(frequencyFromPeriod("Monthly")).toBe("monthly");
    expect(frequencyFromPeriod("Quarterly")).toBe("quarterly");
    expect(frequencyFromPeriod("SemiAnnual")).toBe("semiannual");
    expect(frequencyFromPeriod("Annual")).toBe("annual");
    expect(frequencyFromPeriod("Other")).toBeNull();
    expect(frequencyFromPeriod(null)).toBeNull();
  });
});

describe("inferFrequency", () => {
  it("detects monthly cadence", () => {
    expect(
      inferFrequency(["2026-01-30", "2026-02-27", "2026-03-31", "2026-04-30", "2026-05-29"]),
    ).toBe("monthly");
  });
  it("detects quarterly cadence", () => {
    expect(inferFrequency(["2025-08-11", "2025-11-10", "2026-02-09", "2026-05-11"])).toBe(
      "quarterly",
    );
  });
  it("detects annual cadence", () => {
    expect(inferFrequency(["2024-03-20", "2025-03-19", "2026-03-18"])).toBe("annual");
  });
  it("returns irregular for erratic gaps", () => {
    expect(inferFrequency(["2025-01-10", "2025-02-01", "2025-07-15", "2026-01-02"])).toBe(
      "irregular",
    );
  });
  it("returns irregular with fewer than 3 dates", () => {
    expect(inferFrequency(["2026-01-30", "2026-02-27"])).toBe("irregular");
  });
});

const histRow = (exDate: string, amount: string): DividendHistoryRow => ({
  symbol: "X",
  exDate,
  amountPerShare: amount,
  currency: "USD",
});

describe("excludeSpecialDividends", () => {
  it("drops an off-schedule outlier payment", () => {
    const rows = [
      histRow("2025-08-11", "0.50"),
      histRow("2025-11-10", "0.50"),
      histRow("2025-11-24", "2.50"), // special: 5x amount, 14d after a regular
      histRow("2026-02-09", "0.52"),
      histRow("2026-05-11", "0.52"),
    ];
    const kept = excludeSpecialDividends(rows);
    expect(kept.map((r) => r.exDate)).not.toContain("2025-11-24");
    expect(kept).toHaveLength(4);
  });

  it("keeps a large but on-schedule payment (a raise, not a special)", () => {
    const rows = [
      histRow("2025-08-11", "0.20"),
      histRow("2025-11-10", "0.20"),
      histRow("2026-02-09", "0.20"),
      histRow("2026-05-11", "0.55"),
    ];
    expect(excludeSpecialDividends(rows)).toHaveLength(4);
  });
});

describe("regularDividendAmount", () => {
  const asOf = new Date("2026-07-01T00:00:00Z");

  it("uses the median of the last three payments for quarterly payers", () => {
    const rows = [
      histRow("2025-08-11", "0.50"),
      histRow("2025-11-10", "0.50"),
      histRow("2026-02-09", "0.52"),
      histRow("2026-05-11", "0.52"),
    ];
    const result = regularDividendAmount(rows, "quarterly", asOf);
    expect(result?.amount.toFixed(2)).toBe("0.52");
    expect(result?.confidence).toBe("high");
  });

  it("flags variable payers low-confidence and averages the trailing year", () => {
    const rows = [
      histRow("2026-03-10", "0.80"),
      histRow("2026-04-10", "0.30"),
      histRow("2026-05-10", "1.10"),
      histRow("2026-06-10", "0.40"),
    ];
    const result = regularDividendAmount(rows, "monthly", asOf);
    expect(result?.confidence).toBe("low");
    expect(result?.amount.toFixed(3)).toBe("0.650"); // mean of the four
  });

  it("returns null when the payer has gone quiet (no trailing-12M rows)", () => {
    const rows = [histRow("2024-05-11", "0.50")];
    expect(regularDividendAmount(rows, "quarterly", asOf)).toBeNull();
  });
});

describe("classifyDividendTrend", () => {
  it("returns unknown for null cagr", () => {
    expect(classifyDividendTrend(null)).toBe("unknown");
  });
  it("returns climbing at or above +2%", () => {
    expect(classifyDividendTrend(new Decimal("0.02"))).toBe("climbing");
    expect(classifyDividendTrend(new Decimal("0.15"))).toBe("climbing");
  });
  it("returns cutting at or below -2%", () => {
    expect(classifyDividendTrend(new Decimal("-0.02"))).toBe("cutting");
    expect(classifyDividendTrend(new Decimal("-0.5"))).toBe("cutting");
  });
  it("returns flat between the thresholds", () => {
    expect(classifyDividendTrend(new Decimal("0"))).toBe("flat");
    expect(classifyDividendTrend(new Decimal("0.019"))).toBe("flat");
    expect(classifyDividendTrend(new Decimal("-0.019"))).toBe("flat");
  });
});

describe("clampDividendGrowth", () => {
  it("passes a positive value through unchanged regardless of the flag", () => {
    expect(clampDividendGrowth(new Decimal("0.05"), true).toFixed(4)).toBe("0.0500");
    expect(clampDividendGrowth(new Decimal("0.05"), false).toFixed(4)).toBe("0.0500");
  });
  it("passes a negative value through when allowNegative is true", () => {
    expect(clampDividendGrowth(new Decimal("-0.03"), true).toFixed(4)).toBe("-0.0300");
  });
  it("floors a negative value to zero when allowNegative is false", () => {
    expect(clampDividendGrowth(new Decimal("-0.03"), false).toFixed(4)).toBe("0.0000");
  });
  it("leaves zero unchanged either way", () => {
    expect(clampDividendGrowth(new Decimal("0"), false).toFixed(4)).toBe("0.0000");
    expect(clampDividendGrowth(new Decimal("0"), true).toFixed(4)).toBe("0.0000");
  });
});

describe("projectionHorizonIso", () => {
  it("is one year from the date given", () => {
    expect(projectionHorizonIso(new Date("2026-09-10T00:00:00Z"))).toBe("2027-09-10");
  });

  it("rolls a leap day forward to Mar 1 rather than clamping to Feb 28", () => {
    // Documented because it is the one input where "one year later" has no
    // exact answer: `setUTCFullYear` rolls Feb 29 over rather than clamping, so
    // the horizon is a day longer than a strict year. Left alone deliberately —
    // it costs one extra forecast day once every four years, and changing it
    // would move projection output for no benefit anyone can perceive.
    expect(projectionHorizonIso(new Date("2024-02-29T00:00:00Z"))).toBe("2025-03-01");
  });

  it("is the bound projectDividendSchedule actually honours", () => {
    const row = (exDate: string, paymentDate: string): DividendHistoryRow => ({
      symbol: "THAMES.L",
      exDate,
      paymentDate,
      amountPerShare: "1",
      currency: "GBP",
      period: "Quarterly",
    });
    // The whole point of exporting it: the UI names this date, so it must be
    // the same date the projection stops at, not a second copy of the rule.
    const asOf = new Date("2026-09-10T00:00:00Z");
    const rows = projectDividendSchedule({
      symbol: "THAMES.L",
      quantity: new Decimal("100"),
      history: [
        row("2026-03-10", "2026-03-24"),
        row("2026-06-10", "2026-06-24"),
        row("2026-09-09", "2026-09-23"),
      ],
      announced: [],
      asOf,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.exDate <= projectionHorizonIso(asOf)).toBe(true);
  });
});
