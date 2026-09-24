import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { IFxRateService } from "@sage/provider-interface";
import { Decimal } from "@sage/core";
import { describeDb, withTestDb, type TestDb } from "../testing";
import {
  instrument,
  transaction,
  portfolio,
  user,
  customHolding,
  dividendHistory,
  customIncome,
} from "../db/schema";
import { buildDividendIncomeView } from "./dividend-income-view";

// Pin "now" to the date the live Snowball parity gap was found against.
const NOW = new Date("2026-07-18T12:00:00Z");

describeDb("buildDividendIncomeView — custom holding income projection", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u1";

  beforeAll(async () => {
    // Freeze only the Date class (not timers) so the real Postgres/
    // testcontainers I/O keeps working — same technique as
    // asset-income.test.ts's custom-holding case.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });

    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U",
      email: "u@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await t.db.insert(instrument).values({
      symbol: "CASH_DKK",
      name: "Cash account",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "CASH_DKK",
      portfolioId,
      holdingType: "savings",
      sector: "Cash",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: "2041-05-01",
      autoAdd: true,
      reinvest: true,
    });

    // Buys totaling 39913.24 shares @ 1 DKK before the first payment date,
    // plus the price-0 reinvest credit (Snowball's STOCK_AS_DIVIDEND import
    // shape) landing exactly on it — mirrors the live CASH_DKK position.
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "39913.24",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-01-15",
      },
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "86.75505479",
        price: "0",
        currency: "DKK",
        tradeDate: "2026-04-30",
      },
    ]);

    // One historical engine payment — a single payment can't be
    // cadence-inferred by projectDividendSchedule, which is the whole bug.
    await t.db.insert(dividendHistory).values({
      symbol: "CASH_DKK",
      exDate: "2026-04-30",
      amountPerShare: "0.0033367676",
      currency: "DKK",
      paymentDate: "2026-04-30",
      paymentDateEstimated: false,
      source: "custom",
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("projects the next 12 months from the stored schedule, not history inference", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, { currency: null });

    const symbolRows = view.projected.filter((r) => r.symbol === "CASH_DKK");
    // Four quarterly windows land inside the 12-month horizon from 2026-07-18:
    // 2026-07-30, 2026-10-30, 2027-01-30, 2027-04-30 — day counts since the
    // PRIOR schedule date are 91, 92, 92, 90 (sums to exactly 365, one full
    // year of quarters after the 2026-04-30 first payment).
    expect(symbolRows).toHaveLength(4);
    expect(symbolRows.map((r) => r.projectedExDate)).toEqual([
      "2026-07-30",
      "2026-10-30",
      "2027-01-30",
      "2027-04-30",
    ]);

    const shares = 39913.24 + 86.75505479; // 39999.99505479
    const yearlyPct = 0.0425;
    const dayCounts = [91, 92, 92, 90];
    // Expected = shares × price(1) × pct × dayCount/365 per window, rounded to
    // the cent (matching the implementation's per-row `.toFixed(2)`), summed.
    const expectedTotal = dayCounts.reduce(
      (sum, days) => sum + Math.round(shares * yearlyPct * (days / 365) * 100) / 100,
      0,
    );
    expect(expectedTotal).toBeCloseTo(1700, 0); // ~40,000 × 4.25%

    const actualTotal = symbolRows.reduce((sum, r) => sum + Number(r.income), 0);
    expect(actualTotal).toBeCloseTo(expectedTotal, 2);

    // The old history-inferred single-payment projection (~177.45 DKK total)
    // must be gone — this is the regression the parity gap was about.
    expect(actualTotal).not.toBeCloseTo(177.45, 0);

    const projectedSummary = Number(view.summary.projectedTwelveMonthIncome[0]!.amount);
    expect(projectedSummary).toBeCloseTo(expectedTotal, 2);
  });

  it("carries the schedule on through the long range, ungrown", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, { currency: null });

    const rows = view.longRange.filter((r) => r.symbol === "CASH_DKK");
    expect(rows[0]!.projectedExDate).toBe("2027-07-30");
    expect(rows.at(-1)!.projectedExDate).toBe("2029-10-30");
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.growthPct === null)).toBe(true);
  });
});

describeDb("buildDividendIncomeView — long range", () => {
  let t: TestDb;

  /** Quarterly history 2020–mid 2026, the per-share amount scaled by `factor`
   *  each year: a steady raiser or a steady cutter with five full years. */
  function quarterlyHistory(symbol: string, start: number, factor: number) {
    const rows = [];
    for (let year = 2020; year <= 2026; year++) {
      for (const md of ["03-15", "06-15", "09-15", "12-15"]) {
        const exDate = `${year}-${md}`;
        if (exDate > "2026-06-30") continue;
        rows.push({
          symbol,
          exDate,
          amountPerShare: (start * factor ** (year - 2020)).toFixed(4),
          currency: "USD",
          paymentDate: exDate,
          paymentDateEstimated: false,
          period: "Quarterly",
        });
      }
    }
    return rows;
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    t = await withTestDb();
    await t.db.insert(user).values([
      {
        id: "lr-grow",
        name: "G",
        email: "g@x.dk",
        emailVerified: true,
        allowNegativeDividendGrowth: false,
      },
      {
        id: "lr-neg",
        name: "N",
        email: "n@x.dk",
        emailVerified: true,
        allowNegativeDividendGrowth: true,
      },
    ]);
    await t.db.insert(instrument).values([
      { symbol: "RISECO", name: "Rise Co", exchange: "XNYS", currency: "USD", assetType: "stock" },
      { symbol: "FALLCO", name: "Fall Co", exchange: "XNYS", currency: "USD", assetType: "stock" },
    ]);
    await t.db
      .insert(dividendHistory)
      .values([...quarterlyHistory("RISECO", 0.5, 1.1), ...quarterlyHistory("FALLCO", 1, 0.9)]);
    for (const userId of ["lr-grow", "lr-neg"]) {
      const [pf] = await t.db
        .insert(portfolio)
        .values({ userId, name: "Main" })
        .returning({ id: portfolio.id });
      await t.db.insert(transaction).values(
        ["RISECO", "FALLCO"].map((instrumentSymbol) => ({
          portfolioId: pf!.id,
          instrumentSymbol,
          type: "buy",
          quantity: "10",
          price: "20",
          currency: "USD",
          tradeDate: "2019-06-03",
        })),
      );
    }
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  const build = (userId: string) =>
    buildDividendIncomeView({ db: t.db, provider: new FakeMarketDataProvider() }, userId, {
      currency: null,
    });

  it("starts after the 12-month forecast and ends on 31 December three years out", async () => {
    const view = await build("lr-grow");
    expect(view.longRangeThrough).toBe("2029-12-31");
    expect(view.projected.length).toBeGreaterThan(0);
    const firstLong = view.longRange.map((r) => r.projectedExDate).sort()[0]!;
    expect(firstLong > view.projectedThrough).toBe(true);
    expect(view.longRange.every((r) => r.projectedExDate <= "2029-12-31")).toBe(true);
    const shortKeys = new Set(view.projected.map((r) => `${r.symbol}|${r.projectedExDate}`));
    expect(view.longRange.some((r) => shortKeys.has(`${r.symbol}|${r.projectedExDate}`))).toBe(
      false,
    );
  });

  it("grows a rising payer and holds a falling one flat when negatives are off", async () => {
    const view = await build("lr-grow");
    const rise = view.longRange.filter((r) => r.symbol === "RISECO");
    expect(rise[0]!.growthPct).toBeCloseTo(10, 0);
    expect(Number(rise.at(-1)!.amountPerShare)).toBeGreaterThan(Number(rise[0]!.amountPerShare));
    const fall = view.longRange.filter((r) => r.symbol === "FALLCO");
    expect(fall[0]!.growthPct).toBe(0);
    expect(new Set(fall.map((r) => r.amountPerShare)).size).toBe(1);
  });

  it("lets a falling payer shrink when negatives are allowed", async () => {
    const view = await build("lr-neg");
    const fall = view.longRange.filter((r) => r.symbol === "FALLCO");
    expect(fall[0]!.growthPct).toBeCloseTo(-10, 0);
    expect(Number(fall.at(-1)!.amountPerShare)).toBeLessThan(Number(fall[0]!.amountPerShare));
  });
});

describeDb("buildDividendIncomeView — history from the ledger", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u-ledger";
  const NOW_LEDGER = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_LEDGER });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "L",
      email: "l@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await t.db.insert(instrument).values([
      { symbol: "SOLD", name: "Sold Co", exchange: "NASDAQ", currency: "USD", assetType: "stock" },
      { symbol: "DUAL", name: "Dual Co", exchange: "NASDAQ", currency: "USD", assetType: "stock" },
      // Bought, paid, and fully sold like SOLD, but in a currency (DKK) that
      // no current position holds — before the fix, `fxRates` was built only
      // from synthetic rows scoped to current positions, so this currency
      // never got a rate and the whole payment silently vanished downstream.
      {
        symbol: "SOLD_DKK",
        name: "Sold DKK Co",
        exchange: "CPH",
        currency: "DKK",
        assetType: "stock",
      },
    ]);

    await t.db.insert(transaction).values([
      // SOLD: bought, paid a dividend, then fully sold. Gone from today's
      // positions — but the payment happened and must still count.
      {
        portfolioId,
        instrumentSymbol: "SOLD",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: "2023-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "SOLD",
        type: "dividend",
        quantity: "10",
        price: "0.50",
        currency: "USD",
        tradeDate: "2023-06-15",
      },
      {
        portfolioId,
        instrumentSymbol: "SOLD",
        type: "sell",
        quantity: "10",
        price: "120",
        currency: "USD",
        tradeDate: "2023-09-01",
      },
      // DUAL: still held, and its March 2024 payment is described BOTH by a
      // ledger row and by provider history — it must be counted once.
      {
        portfolioId,
        instrumentSymbol: "DUAL",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "USD",
        tradeDate: "2024-01-05",
      },
      {
        portfolioId,
        instrumentSymbol: "DUAL",
        type: "dividend",
        quantity: "10",
        price: "0.30",
        currency: "USD",
        tradeDate: "2024-03-20",
      },
      // SOLD_DKK: bought, paid a dividend in DKK, then fully sold — same
      // shape as SOLD, but in a currency held by nothing else in this book.
      {
        portfolioId,
        instrumentSymbol: "SOLD_DKK",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "DKK",
        tradeDate: "2025-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "SOLD_DKK",
        type: "dividend",
        quantity: "10",
        price: "0.80",
        currency: "DKK",
        tradeDate: "2025-06-15",
      },
      {
        portfolioId,
        instrumentSymbol: "SOLD_DKK",
        type: "sell",
        quantity: "10",
        price: "120",
        currency: "DKK",
        tradeDate: "2025-09-01",
      },
    ]);

    await t.db.insert(dividendHistory).values({
      symbol: "DUAL",
      exDate: "2024-03-10",
      amountPerShare: "0.30",
      currency: "USD",
      paymentDate: "2024-03-20",
      paymentDateEstimated: false,
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("counts dividends from a holding that has since been fully sold", async () => {
    // The reported bug: 2023 vanished from the snowball because its only
    // payers had been sold, so their symbols never reached the history query.
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });

    const y2023 = view.summary.receivedByYear.find((r) => r.year === "2023");
    expect(y2023).toBeDefined();
    expect(Number(y2023!.amount)).toBeCloseTo(5, 2); // 10 x 0.50

    const june = view.summary.monthlyBreakdown.find((m) => m.month === "2023-06");
    expect(june).toBeDefined();
    expect(Number(june!.retroactive)).toBeCloseTo(5, 2);

    expect(view.retroactive.some((r) => r.symbol === "SOLD")).toBe(true);
  });

  it("names a sold holding rather than falling back to its ticker", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    const row = view.retroactive.find((r) => r.symbol === "SOLD");
    expect(row!.name).toBe("Sold Co");
  });

  it("counts a payment once when both a ledger row and provider history exist", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    const march = view.summary.monthlyBreakdown.find((m) => m.month === "2024-03");
    expect(march).toBeDefined();
    expect(Number(march!.retroactive)).toBeCloseTo(3, 2); // 10 x 0.30, ONCE
  });

  it("leaves per-share null on an imported row", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    const row = view.retroactive.find((r) => r.symbol === "SOLD");
    expect(row!.amountPerShare).toBeNull();
  });

  it("still converts and counts a sold-out holding's dividend in a currency no current position holds", async () => {
    // CRITICAL fix under test: `fxRates` used to be built only from synthetic
    // rows scoped to current positions (DUAL, USD), so DKK — held only by the
    // now fully-sold SOLD_DKK — never got a rate. `convertAmount` then
    // returned the DKK amount unconverted, and every `inDisplay` aggregation
    // (keyed on displayCcy === "USD") silently dropped it. That's the exact
    // bug this file exists to fix, just for a foreign currency instead of USD.
    const provider = new FakeMarketDataProvider();
    const fxStub: IFxRateService = {
      getRate: () => Promise.resolve(new Decimal(7)),
      getRates: (_base, targets) =>
        Promise.resolve(new Map(targets.map((c) => [c, new Decimal(7)]))),
    };
    const view = await buildDividendIncomeView(
      { db: t.db, provider, fxRateService: fxStub },
      userId,
      { currency: "USD" },
    );

    // 10 shares x 0.80 DKK = 8.00 DKK; / rate 7 = 1.142857... -> 1.14 USD.
    const row = view.retroactive.find((r) => r.symbol === "SOLD_DKK");
    expect(row).toBeDefined();
    expect(row!.currency).toBe("USD");
    expect(Number(row!.income)).toBeCloseTo(1.14, 2);

    const y2025 = view.summary.receivedByYear.find((r) => r.year === "2025");
    expect(y2025).toBeDefined();
    expect(y2025!.currency).toBe("USD");
    expect(Number(y2025!.amount)).toBeCloseTo(1.14, 2);
  });

  it("does not report incomeRecordingOff when dividend transactions exist", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    expect(view.incomeRecordingOff).toBe(false);
  });
});

describeDb("buildDividendIncomeView — fully liquidated portfolio", () => {
  let t: TestDb;
  const userId = "u-liquidated";
  const NOW_LIQ = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_LIQ });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "Liquidated",
      email: "liq@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    const portfolioId = pf!.id;

    await t.db.insert(instrument).values([
      {
        symbol: "GONE1",
        name: "Gone One",
        exchange: "NASDAQ",
        currency: "USD",
        assetType: "stock",
      },
      {
        symbol: "GONE2",
        name: "Gone Two",
        exchange: "NASDAQ",
        currency: "USD",
        assetType: "stock",
      },
    ]);

    // Every holding bought, paid a dividend, then entirely sold — so
    // `positions` (and `symbols`) is empty by "now". Two symbols across two
    // different years, so `receivedByYear` has something to aggregate.
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "GONE1",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "USD",
        tradeDate: "2022-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "GONE1",
        type: "dividend",
        quantity: "10",
        price: "0.40",
        currency: "USD",
        tradeDate: "2022-06-15",
      },
      {
        portfolioId,
        instrumentSymbol: "GONE1",
        type: "sell",
        quantity: "10",
        price: "60",
        currency: "USD",
        tradeDate: "2022-09-01",
      },
      {
        portfolioId,
        instrumentSymbol: "GONE2",
        type: "buy",
        quantity: "20",
        price: "30",
        currency: "USD",
        tradeDate: "2023-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "GONE2",
        type: "dividend",
        quantity: "20",
        price: "0.25",
        currency: "USD",
        tradeDate: "2023-06-15",
      },
      {
        portfolioId,
        instrumentSymbol: "GONE2",
        type: "sell",
        quantity: "20",
        price: "35",
        currency: "USD",
        tradeDate: "2023-09-01",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("still reports receivedByYear when every holding has since been sold", async () => {
    // The reported-bug class, worst case: `symbols.length === 0` used to
    // early-return `retroactive: []` before any ledger read at all, so a
    // user who sold everything saw an empty snowball despite years of real
    // dividend payments.
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });

    const y2022 = view.summary.receivedByYear.find((r) => r.year === "2022");
    expect(y2022).toBeDefined();
    expect(Number(y2022!.amount)).toBeCloseTo(4, 2); // 10 x 0.40

    const y2023 = view.summary.receivedByYear.find((r) => r.year === "2023");
    expect(y2023).toBeDefined();
    expect(Number(y2023!.amount)).toBeCloseTo(5, 2); // 20 x 0.25

    expect(view.retroactive.some((r) => r.symbol === "GONE1")).toBe(true);
    expect(view.retroactive.some((r) => r.symbol === "GONE2")).toBe(true);
  });
});

describeDb("buildDividendIncomeView — reinvested custom-income history (CRITICAL 2)", () => {
  let t: TestDb;
  const userId = "u-reinvest";
  const NOW_REINVEST = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_REINVEST });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "Reinvest",
      email: "reinvest@x.dk",
      emailVerified: true,
      displayCurrency: "DKK",
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    const portfolioId = pf!.id;

    await t.db.insert(instrument).values({
      symbol: "REINVEST_CO",
      name: "Reinvest Co",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "REINVEST_CO",
      portfolioId,
      holdingType: "savings",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-03-15",
      autoAdd: true,
      reinvest: true,
    });

    // Real cash contribution, then a reinvest credit — a price-0 `buy`
    // (custom-income-sync's shape for reinvest: cost basis untouched), then a
    // FULL sell afterward to prove the payment survives being sold out,
    // exactly like the real-stock "SOLD" cases above.
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "REINVEST_CO",
        type: "buy",
        quantity: "100",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "REINVEST_CO",
        type: "buy",
        quantity: "5",
        price: "0",
        currency: "DKK",
        fee: "0.5",
        feeCurrency: "DKK",
        tradeDate: "2026-03-15",
        source: "custom-income",
      },
      {
        portfolioId,
        instrumentSymbol: "REINVEST_CO",
        type: "sell",
        quantity: "105",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-05-01",
      },
    ]);

    // The paired history fact custom-income-sync always writes alongside the
    // reinvest credit — this is the ONLY place the payment's dollar value
    // lives, since the buy row's price is 0 by design.
    await t.db.insert(dividendHistory).values({
      symbol: "REINVEST_CO",
      exDate: "2026-03-15",
      amountPerShare: "1", // gross 1 DKK/share x 105 shares held (incl. credit) = 105
      currency: "DKK",
      paymentDate: "2026-03-15",
      paymentDateEstimated: false,
      source: "custom",
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("appears in receivedByYear exactly once, even though its ledger row has no `dividend` type", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "DKK",
    });

    // Before the fix: buildReceivedDividends only recognizes type "dividend",
    // so this reinvested payment had ZERO ledger footprint and vanished
    // entirely — not in `retroactive`, not in `receivedByYear`.
    const reinvestRows = view.retroactive.filter((r) => r.symbol === "REINVEST_CO");
    expect(reinvestRows).toHaveLength(1); // exactly once, not zero, not twice
    expect(Number(reinvestRows[0]!.income)).toBeCloseTo(105, 2);

    const y2026 = view.summary.receivedByYear.find((r) => r.year === "2026");
    expect(y2026).toBeDefined();
    expect(Number(y2026!.amount)).toBeCloseTo(105, 2);
  });
});

describeDb("buildDividendIncomeView — received/in-flight overlap (IMPORTANT 1)", () => {
  let t: TestDb;
  const userId = "u-overlap";
  const NOW_OVERLAP = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_OVERLAP });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "Overlap",
      email: "overlap@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    const portfolioId = pf!.id;

    await t.db.insert(instrument).values({
      symbol: "OVERLAP",
      name: "Overlap Co",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
    });
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "OVERLAP",
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "USD",
        tradeDate: "2023-01-10",
      },
      // Broker credited the cash a few days ahead of the provider's payment
      // date. Lands in `received` (cash date <= today).
      {
        portfolioId,
        instrumentSymbol: "OVERLAP",
        type: "dividend",
        quantity: "10",
        price: "0.50",
        currency: "USD",
        tradeDate: "2026-07-15",
      },
    ]);

    // Provider still shows the payment as pending: ex-date has passed, but its
    // payment date (2026-07-20) is 5 days after the ledger's cash date — well
    // inside the ±10-day match window. Without the fix, this row survives
    // into `inFlight` untouched and the payment is counted twice.
    await t.db.insert(dividendHistory).values({
      symbol: "OVERLAP",
      exDate: "2026-07-05",
      amountPerShare: "0.50",
      currency: "USD",
      paymentDate: "2026-07-20",
      paymentDateEstimated: false,
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("yields ONE payment, not two, when a ledger row predates the provider's payment date", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });

    const overlapRows = view.retroactive.filter((r) => r.symbol === "OVERLAP");
    // Before the fix: the received (ledger) row AND the in-flight (synthetic)
    // row both survived — same cash counted as history and forward income.
    expect(overlapRows).toHaveLength(1);
    expect(overlapRows[0]!.paymentDate).toBe("2026-07-15"); // the RECEIVED (ledger) row survives
    expect(Number(overlapRows[0]!.income)).toBeCloseTo(5, 2); // 10 x 0.50, ONCE
  });
});

describeDb(
  "buildDividendIncomeView — sold-out reinvesting custom holding, foreign currency (CRITICAL 1)",
  () => {
    let t: TestDb;
    const userId = "u-reinvest-fx";
    const NOW_FX = new Date("2026-07-18T12:00:00Z");

    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: NOW_FX });
      t = await withTestDb();
      // Mirrors the live bug: display currency DKK, the reinvesting custom
      // holding denominated in GBP — a currency held by NOTHING else in the
      // book once it's fully sold. The existing reinvest test (CRITICAL 2
      // above) uses DKK rows against a DKK target, so it can't distinguish "FX
      // rate resolved" from "no conversion needed" — this one can.
      await t.db.insert(user).values({
        id: userId,
        name: "ReinvestFx",
        email: "reinvest-fx@x.dk",
        emailVerified: true,
        displayCurrency: "DKK",
        dividendTaxRate: "35",
      });
      const [pf] = await t.db
        .insert(portfolio)
        .values({ userId, name: "Main" })
        .returning({ id: portfolio.id });
      const portfolioId = pf!.id;

      await t.db.insert(instrument).values({
        symbol: "GBP_SAVE",
        name: "GBP Savings",
        exchange: "CUSTOM",
        currency: "GBP",
        assetType: "custom",
      });
      await t.db.insert(customHolding).values({
        symbol: "GBP_SAVE",
        portfolioId,
        holdingType: "savings",
        incomeEnabled: true,
        incomeYearlyPct: "3.37",
        frequencyUnit: "week",
        frequencyInterval: 1,
        firstPaymentDate: "2026-03-15",
        autoAdd: true,
        reinvest: true,
      });

      await t.db.insert(transaction).values([
        {
          portfolioId,
          instrumentSymbol: "GBP_SAVE",
          type: "buy",
          quantity: "99",
          price: "1",
          currency: "GBP",
          tradeDate: "2026-01-10",
        },
        // Reinvest credit landing exactly on the payment date — sharesAtPay
        // (99 + 1 = 100) matches the dividend_history amountPerShare below.
        {
          portfolioId,
          instrumentSymbol: "GBP_SAVE",
          type: "buy",
          quantity: "1",
          price: "0",
          currency: "GBP",
          fee: "0.54",
          feeCurrency: "GBP",
          tradeDate: "2026-03-15",
          source: "custom-income",
        },
        // Fully sold afterward — gone from today's positions, the way a
        // dust-level remainder (shares ~= 1e-8) does after a full sell.
        {
          portfolioId,
          instrumentSymbol: "GBP_SAVE",
          type: "sell",
          quantity: "100",
          price: "1",
          currency: "GBP",
          tradeDate: "2026-05-01",
        },
      ]);

      await t.db.insert(dividendHistory).values({
        symbol: "GBP_SAVE",
        exDate: "2026-03-15",
        amountPerShare: "1", // gross 1 GBP/share x 100 shares held (incl. credit) = 100 GBP
        currency: "GBP",
        paymentDate: "2026-03-15",
        paymentDateEstimated: false,
        source: "custom",
      });
    }, 120_000);

    afterAll(async () => {
      vi.useRealTimers();
      await t.stop();
    });

    it("still appears in receivedByYear, converted, once the holding is fully sold", async () => {
      // CRITICAL fix under test: `ledgerDividendCurrencies`/`allCurrencies` used
      // to be built BEFORE the custom/reinvest history query ran, so GBP —
      // which nothing else in this book holds once GBP_SAVE is sold out — never
      // reached the FX rate request. `convertAmount` then returned the GBP
      // amount unconverted, and `inDisplay` (keyed on displayCcy === "DKK")
      // silently dropped it — this is the shape of a real live bug: a
      // sold-out foreign-currency custom holding whose dividend income
      // vanished from the converted total.
      const fxStub: IFxRateService = {
        getRate: () => Promise.resolve(new Decimal(0.1)),
        getRates: (_base, targets) =>
          Promise.resolve(new Map(targets.map((c) => [c, new Decimal(0.1)]))),
      };
      const view = await buildDividendIncomeView(
        { db: t.db, provider: new FakeMarketDataProvider(), fxRateService: fxStub },
        userId,
        { currency: "DKK" },
      );

      // 100 GBP / rate 0.1 = 1000 DKK.
      const row = view.retroactive.find((r) => r.symbol === "GBP_SAVE");
      expect(row).toBeDefined();
      expect(row!.currency).toBe("DKK");
      expect(Number(row!.income)).toBeCloseTo(1000, 2);

      const y2026 = view.summary.receivedByYear.find((r) => r.year === "2026");
      expect(y2026).toBeDefined();
      expect(y2026!.currency).toBe("DKK");
      expect(Number(y2026!.amount)).toBeCloseTo(1000, 2);
    });
  },
);

describeDb(
  "buildDividendIncomeView — deleted non-reinvest custom payment stays deleted (IMPORTANT 3)",
  () => {
    let t: TestDb;
    const userId = "u-deleted-payment";
    const NOW_DEL = new Date("2026-07-18T12:00:00Z");

    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: NOW_DEL });
      t = await withTestDb();
      await t.db.insert(user).values({
        id: userId,
        name: "Deleted",
        email: "deleted@x.dk",
        emailVerified: true,
        displayCurrency: "DKK",
        dividendTaxRate: "35",
      });
      const [pf] = await t.db
        .insert(portfolio)
        .values({ userId, name: "Main" })
        .returning({ id: portfolio.id });
      const portfolioId = pf!.id;

      await t.db.insert(instrument).values({
        symbol: "CASH_CO",
        name: "Cash Co",
        exchange: "CUSTOM",
        currency: "DKK",
        assetType: "custom",
      });
      // NON-reinvest: cash payments land as real ledger `dividend` rows, not
      // price-0 buys — this holding's payments must be read straight from the
      // ledger, never from `dividend_history` reconstruction.
      await t.db.insert(customHolding).values({
        symbol: "CASH_CO",
        portfolioId,
        holdingType: "savings",
        incomeEnabled: true,
        incomeYearlyPct: "3.0",
        frequencyUnit: "quarter",
        frequencyInterval: 1,
        firstPaymentDate: "2026-03-15",
        autoAdd: true,
        reinvest: false,
      });

      await t.db.insert(transaction).values({
        portfolioId,
        instrumentSymbol: "CASH_CO",
        type: "buy",
        quantity: "100",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-01-10",
      });

      // The state AFTER a user deletes a materialized non-reinvest payment:
      // custom-income-sync's `custom_income` row persists as a tombstone
      // (transactionId set to null, per the FK's ON DELETE SET NULL — see
      // db/schema/custom-holding.ts), but its paired `dividend_history` row
      // (source: "custom") is untouched by that delete. No ledger `dividend`
      // transaction exists for this date — it was deleted.
      await t.db.insert(dividendHistory).values({
        symbol: "CASH_CO",
        exDate: "2026-03-15",
        amountPerShare: "0.75",
        currency: "DKK",
        paymentDate: "2026-03-15",
        paymentDateEstimated: false,
        source: "custom",
      });
      await t.db.insert(customIncome).values({
        portfolioId,
        symbol: "CASH_CO",
        payDate: "2026-03-15",
        transactionId: null,
      });
    }, 120_000);

    afterAll(async () => {
      vi.useRealTimers();
      await t.stop();
    });

    it("does not resurrect the deleted payment from dividend_history", async () => {
      const view = await buildDividendIncomeView(
        { db: t.db, provider: new FakeMarketDataProvider() },
        userId,
        { currency: "DKK" },
      );

      // Before the fix: the reconstruction read every `source: "custom"` row
      // without checking `customHolding.reinvest` or the tombstone, so a
      // deleted non-reinvest payment reappeared as if it had never been removed.
      const rows = view.retroactive.filter((r) => r.symbol === "CASH_CO");
      expect(rows).toHaveLength(0);

      const y2026 = view.summary.receivedByYear.find((r) => r.year === "2026");
      expect(y2026).toBeUndefined();
    });
  },
);

describeDb("buildDividendIncomeView — fxIncomplete on received rows", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u-fx";
  const NOW_FX = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_FX });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "F",
      email: "f@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    await t.db.insert(instrument).values([
      { symbol: "USDCO", name: "USD Co", exchange: "NASDAQ", currency: "USD", assetType: "stock" },
      { symbol: "JPYCO", name: "JPY Co", exchange: "TSE", currency: "JPY", assetType: "stock" },
    ]);
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "USDCO",
        type: "buy",
        quantity: "10",
        price: "50",
        currency: "USD",
        tradeDate: "2024-01-05",
      },
      {
        portfolioId,
        instrumentSymbol: "USDCO",
        type: "dividend",
        quantity: "10",
        price: "0.30",
        currency: "USD",
        tradeDate: "2024-03-20",
      },
      {
        portfolioId,
        instrumentSymbol: "JPYCO",
        type: "buy",
        quantity: "5",
        price: "1000",
        currency: "JPY",
        tradeDate: "2024-01-10",
      },
      {
        portfolioId,
        instrumentSymbol: "JPYCO",
        type: "dividend",
        quantity: "5",
        price: "20",
        currency: "JPY",
        tradeDate: "2024-05-10",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("flags fxIncomplete when a received row cannot be converted", async () => {
    // No JPY rate: the row stays in JPY and is correctly excluded from the USD
    // totals rather than added dishonestly — but the exclusion must be visible.
    const provider = new FakeMarketDataProvider();
    const fxRateService: IFxRateService = {
      getRate: () => Promise.reject(new Error("not used by this test")),
      getRates: () => Promise.resolve(new Map<string, Decimal>()),
    };
    const view = await buildDividendIncomeView({ db: t.db, provider, fxRateService }, userId, {
      currency: "USD",
    });
    expect(view.fxIncomplete).toBe(true);
  });

  it("does not flag fxIncomplete when every received row converts", async () => {
    const provider = new FakeMarketDataProvider();
    const fxRateService: IFxRateService = {
      getRate: () => Promise.reject(new Error("not used by this test")),
      getRates: () => Promise.resolve(new Map<string, Decimal>([["JPY", new Decimal("150")]])),
    };
    const view = await buildDividendIncomeView({ db: t.db, provider, fxRateService }, userId, {
      currency: "USD",
    });
    expect(view.fxIncomplete).toBe(false);
  });
});

describeDb("buildDividendIncomeView — empty ledger", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u-empty";
  const NOW_EMPTY = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_EMPTY });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "E",
      email: "e@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main", autoAddDividends: false })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    // Held, and the provider knows it pays — but nothing was ever recorded.
    await t.db.insert(instrument).values({
      symbol: "NOREC",
      name: "No Record Co",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
    });
    await t.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "NOREC",
      type: "buy",
      quantity: "10",
      price: "50",
      currency: "USD",
      tradeDate: "2024-01-05",
    });
    await t.db.insert(dividendHistory).values({
      symbol: "NOREC",
      exDate: "2024-03-10",
      amountPerShare: "0.30",
      currency: "USD",
      paymentDate: "2024-03-20",
      paymentDateEstimated: false,
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("reports incomeRecordingOff when nothing is recorded but history exists", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    expect(view.summary.receivedByYear).toEqual([]);
    expect(view.incomeRecordingOff).toBe(true);
  });
});

describeDb("buildDividendIncomeView — freshly bought dividend payer, recording on", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u-fresh-buy";
  const NOW_FRESH = new Date("2026-07-18T12:00:00Z");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW_FRESH });
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "F",
      email: "f@x.dk",
      emailVerified: true,
      displayCurrency: "USD",
    });
    // autoAddDividends defaults to true — recording is genuinely on.
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main", autoAddDividends: true })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    // Bought yesterday. The provider's dividend history is all from long
    // before the purchase — nothing has been paid (or could have been paid)
    // to this user yet, so the ledger has no `dividend` rows even though
    // reconciliation is fully enabled and working correctly.
    await t.db.insert(instrument).values({
      symbol: "FRESH",
      name: "Freshly Bought Co",
      exchange: "NASDAQ",
      currency: "USD",
      assetType: "stock",
    });
    await t.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "FRESH",
      type: "buy",
      quantity: "10",
      price: "50",
      currency: "USD",
      tradeDate: "2026-07-17",
    });
    await t.db.insert(dividendHistory).values({
      symbol: "FRESH",
      exDate: "2024-03-10",
      amountPerShare: "0.30",
      currency: "USD",
      paymentDate: "2024-03-20",
      paymentDateEstimated: false,
    });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await t.stop();
  });

  it("does not report incomeRecordingOff — recording is on, the first payment just hasn't landed", async () => {
    const provider = new FakeMarketDataProvider();
    const view = await buildDividendIncomeView({ db: t.db, provider }, userId, {
      currency: "USD",
    });
    expect(view.summary.receivedByYear).toEqual([]);
    expect(view.incomeRecordingOff).toBe(false);
  });
});
