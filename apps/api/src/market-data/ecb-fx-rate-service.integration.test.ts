import { it, expect, beforeAll, beforeEach, afterAll, describe, vi } from "vitest";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { fxRateDaily } from "../db/schema";
import { EcbFxRateService } from "./ecb-fx-rate-service";
import { resetEcbSyncStateForTests, ECB_SERIES_START } from "./ecb-sync";

describeDb("EcbFxRateService", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await withTestDb();
    await ctx.db.insert(fxRateDaily).values([
      { date: "2026-08-06", currency: "USD", rate: "1.1600" },
      { date: "2026-08-06", currency: "DKK", rate: "7.4600" },
      { date: "2026-08-07", currency: "USD", rate: "1.1535" },
      { date: "2026-08-07", currency: "DKK", rate: "7.4756" },
    ]);
  });

  afterAll(async () => await ctx.stop());

  it("returns 1 for the same currency", async () => {
    const rate = await new EcbFxRateService(ctx.db).getRate("USD", "USD");
    expect(rate.toFixed()).toBe("1");
  });

  it("prices EUR pairs directly off the newest stored date", async () => {
    const rate = await new EcbFxRateService(ctx.db).getRate("EUR", "USD");
    expect(rate.toFixed(4)).toBe("1.1535");
  });

  it("cross-rates non-EUR pairs through EUR", async () => {
    // 1 USD = 7.4756/1.1535 DKK = 6.4808...
    const rate = await new EcbFxRateService(ctx.db).getRate("USD", "DKK");
    expect(rate.toFixed(4)).toBe("6.4808");
  });

  it("inverts correctly: dividing a USD amount by getRates(DKK,[USD]) yields DKK", async () => {
    const rates = await new EcbFxRateService(ctx.db).getRates("DKK", ["USD"]);
    // units of USD per 1 DKK = 1.1535/7.4756 = 0.15430199... -> 0.15430
    expect(rates.get("USD")!.toFixed(5)).toBe("0.15430");
  });

  it("omits a currency it cannot price rather than faking 1:1", async () => {
    const rates = await new EcbFxRateService(ctx.db).getRates("EUR", ["USD", "INR"]);
    expect(rates.has("USD")).toBe(true);
    expect(rates.has("INR")).toBe(false);
  });

  it("reports the newest stored date", async () => {
    expect(await new EcbFxRateService(ctx.db).latestDate()).toBe("2026-08-07");
  });

  it("prices each date at its own rate", async () => {
    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "EUR",
      ["USD"],
      "2026-08-06",
      "2026-08-07",
    );
    expect(series.rateOn("2026-08-06", "USD")!.toFixed(4)).toBe("1.1600");
    expect(series.rateOn("2026-08-07", "USD")!.toFixed(4)).toBe("1.1535");
  });

  it("forward-fills days ECB did not publish", async () => {
    // 2026-08-08 and -09 are a weekend: no rows exist, so Friday's rate holds.
    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "EUR",
      ["USD"],
      "2026-08-06",
      "2026-08-09",
    );
    expect(series.rateOn("2026-08-08", "USD")!.toFixed(4)).toBe("1.1535");
    expect(series.rateOn("2026-08-09", "USD")!.toFixed(4)).toBe("1.1535");
  });

  it("returns null before the first covered date", async () => {
    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "EUR",
      ["USD"],
      "2026-08-01",
      "2026-08-07",
    );
    expect(series.rateOn("2026-08-01", "USD")).toBeNull();
    expect(series.coversFrom).toBe("2026-08-06");
  });

  it("cross-rates a non-EUR base per date", async () => {
    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "DKK",
      ["USD"],
      "2026-08-06",
      "2026-08-07",
    );
    // 2026-08-06: 1.16/7.46 = 0.1554959... → 0.15550
    // 2026-08-07: 1.1535/7.4756 = 0.1543019... → 0.15430
    expect(series.rateOn("2026-08-06", "USD")!.toFixed(5)).toBe("0.15550");
    expect(series.rateOn("2026-08-07", "USD")!.toFixed(5)).toBe("0.15430");
  });

  it("returns an empty series with null coversFrom when nothing is stored", async () => {
    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "EUR",
      ["JPY"],
      "2026-08-06",
      "2026-08-07",
    );
    expect(series.coversFrom).toBeNull();
    expect(series.rateOn("2026-08-07", "JPY")).toBeNull();
  });

  it("coversFrom is the LATER of two needed currencies' first dates, not the earlier", async () => {
    // GBP only starts publishing a day after USD does, so with both USD and
    // GBP needed, the book can't be fully priced until GBP's later start —
    // coversFrom must be the max (2026-08-07), not the min (2026-08-06).
    await ctx.db
      .insert(fxRateDaily)
      .values([{ date: "2026-08-07", currency: "GBP", rate: "0.8660" }]);

    const series = await new EcbFxRateService(ctx.db).getRateSeries(
      "EUR",
      ["USD", "GBP"],
      "2026-08-06",
      "2026-08-07",
    );
    expect(series.coversFrom).toBe("2026-08-07");
  });

  /** Reads with a feed attached also drive the background catch-up — without
   *  this the process would load rates once at boot and never move again. */
  describe("read-path refresh", () => {
    function stubFeed() {
      return {
        fetchDaily: vi.fn().mockResolvedValue([]),
        fetchRecent: vi.fn().mockResolvedValue([]),
        fetchFullHistory: vi.fn().mockResolvedValue([]),
      };
    }

    // `inFlight`/`lastAttemptAt` are module-level, so one case's attempt would
    // otherwise throttle the next into a no-op.
    beforeEach(() => resetEcbSyncStateForTests());

    // `chooseFeed` picks "recent" vs "full" from the gap between the newest
    // stored date and the REAL, un-mocked `Date.now()` — not from any date a
    // test hardcodes. The outer `beforeAll` seeds fixed 2026-08-06/07 rows;
    // once real time drifts far enough past them the gap exceeds the 90-day
    // "recent" cutoff and these two tests would start exercising `full`
    // instead, failing for a reason unrelated to the wiring they check.
    //
    // A USD row dated "yesterday" relative to whenever the suite actually
    // runs keeps `latestStoredDate()` (a MAX over the whole table) perpetually
    // one day old, so the gap always lands inside the "recent" branch. Reusing
    // 2026-08-07's rate keeps the "reads fine without a feed" test below
    // (which reads off this same latest date) correct regardless of when this
    // runs. `onConflictDoUpdate` guards the (unlikely) case where "yesterday"
    // lands on one of the outer `beforeAll`'s fixed dates.
    //
    // The row at ECB's series start is the OTHER half of the same story:
    // `chooseFeed` also looks at `min(date)`, and a table whose history stops a
    // few days back is an interrupted seed, which it answers with a background
    // backfill rather than the `recent` feed these two cases assert on.
    beforeAll(async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await ctx.db
        .insert(fxRateDaily)
        .values([
          { date: yesterday, currency: "USD", rate: "1.1535" },
          { date: ECB_SERIES_START, currency: "USD", rate: "1.1800" },
        ])
        .onConflictDoUpdate({
          target: [fxRateDaily.date, fxRateDaily.currency],
          set: { rate: "1.1535" },
        });
    });

    it("triggers a refresh when getRates is called", async () => {
      const feed = stubFeed();
      await new EcbFxRateService(ctx.db, feed).getRates("EUR", ["USD"]);
      // Stored rates are older than today, so the gap puts it on the `recent`
      // feed rather than the cold-start seed.
      await vi.waitFor(() => expect(feed.fetchRecent).toHaveBeenCalled());
    });

    it("triggers a refresh when getRateSeries is called", async () => {
      const feed = stubFeed();
      await new EcbFxRateService(ctx.db, feed).getRateSeries(
        "EUR",
        ["USD"],
        "2026-08-06",
        "2026-08-07",
      );
      await vi.waitFor(() => expect(feed.fetchRecent).toHaveBeenCalled());
    });

    it("reads fine without a feed, so a bare service needs no network wiring", async () => {
      const rates = await new EcbFxRateService(ctx.db).getRates("EUR", ["USD"]);
      expect(rates.get("USD")!.toFixed(4)).toBe("1.1535");
    });
  });
});
