import { it, expect, describe, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Decimal } from "@sage/core";
import type { RateDay } from "@sage/provider-ecb";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { fxRateDaily } from "../db/schema";
import {
  chooseFeed,
  requiredCoverageFrom,
  storeRateDays,
  ensureRatesAvailable,
  resetEcbSyncStateForTests,
  earliestStoredDate,
  ECB_SERIES_START,
  REQUIRED_COVERAGE_YEARS,
} from "./ecb-sync";

function day(date: string, usd: string): RateDay {
  return { date, ratesPerEur: new Map([["USD", new Decimal(usd)]]) };
}

/** `YYYY-MM-DD`, `n` days before now. Relative on purpose: an absolute date
 *  silently stops exercising the branch it was written for. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** A date old enough to satisfy the coverage rule, whenever this test runs. */
const COVERED_FROM = ECB_SERIES_START;

describe("chooseFeed", () => {
  // `today` is an argument, so these triples can never expire.
  it("seeds daily-then-full when nothing is stored", () => {
    expect(chooseFeed(null, null, "2026-08-07")).toBe("daily-then-full");
  });

  it("no-ops when storage is already current and the history is there", () => {
    expect(chooseFeed("2026-08-07", COVERED_FROM, "2026-08-07")).toBe("none");
    expect(chooseFeed("2026-08-08", COVERED_FROM, "2026-08-07")).toBe("none");
  });

  it("uses the 90-day feed for a short gap", () => {
    expect(chooseFeed("2026-07-20", COVERED_FROM, "2026-08-07")).toBe("recent");
  });

  it("uses the full feed beyond 90 days", () => {
    expect(chooseFeed("2026-01-01", COVERED_FROM, "2026-08-07")).toBe("full");
  });

  it("backfills when an interrupted seed left only the tail of the series", () => {
    // Exactly what a crashed (or silently empty) full-history seed leaves
    // behind: the blocking daily feed's rows and nothing else. Judged on
    // `latest` alone this reads as perfectly current.
    expect(chooseFeed("2026-08-07", "2026-08-07", "2026-08-07")).toBe("backfill");
  });

  it("backfills a partial seed that reached back only a few years", () => {
    expect(chooseFeed("2026-08-07", "2019-03-11", "2026-08-07")).toBe("backfill");
  });

  it("takes coverage back far enough as complete, even short of 1999", () => {
    expect(chooseFeed("2026-08-07", "2005-01-03", "2026-08-07")).toBe("none");
  });

  it("prefers the backfill over an incremental catch-up when both apply", () => {
    // The full-history file carries the recent days too, so one fetch fixes
    // both ends. Choosing "recent" here would leave the hole forever.
    expect(chooseFeed("2026-07-20", "2026-01-05", "2026-08-07")).toBe("backfill");
  });

  it("never demands coverage earlier than ECB's own series start", () => {
    // Otherwise the rule becomes permanently unsatisfiable and every instance
    // refetches 951 KB every 6 hours forever.
    expect(requiredCoverageFrom("2010-06-01")).toBe(ECB_SERIES_START);
    expect(chooseFeed("2010-06-01", ECB_SERIES_START, "2010-06-01")).toBe("none");
  });

  it("asks for coverage REQUIRED_COVERAGE_YEARS back once the series is old enough", () => {
    expect(requiredCoverageFrom("2026-08-07")).toBe(`${2026 - REQUIRED_COVERAGE_YEARS}-08-07`);
  });
});

describeDb("ecb-sync storage", () => {
  let ctx: TestDb;

  beforeAll(async () => (ctx = await withTestDb()));
  afterAll(async () => await ctx.stop());
  beforeEach(async () => {
    await ctx.db.delete(fxRateDaily);
    resetEcbSyncStateForTests();
  });

  it("stores rate-days and is idempotent under re-run", async () => {
    const days = [day("2026-08-06", "1.1600"), day("2026-08-07", "1.1535")];
    expect(await storeRateDays(ctx.db, days)).toBe(2);
    await storeRateDays(ctx.db, days);
    const rows = await ctx.db.select().from(fxRateDaily);
    expect(rows).toHaveLength(2);
  });

  it("overwrites a revised rate for the same date", async () => {
    await storeRateDays(ctx.db, [day("2026-08-07", "1.1535")]);
    await storeRateDays(ctx.db, [day("2026-08-07", "1.1540")]);
    const rows = await ctx.db.select().from(fxRateDaily);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rate).toBe("1.154");
  });

  it("blocks on the daily feed then seeds full history in the background", async () => {
    const fetchDaily = vi.fn().mockResolvedValue([day("2026-08-07", "1.1535")]);
    let releaseFull: (value: RateDay[]) => void = () => {};
    const fullPromise = new Promise<RateDay[]>((resolve) => (releaseFull = resolve));
    const fetchFullHistory = vi.fn().mockReturnValue(fullPromise);
    const feed = { fetchDaily, fetchRecent: vi.fn(), fetchFullHistory };

    await ensureRatesAvailable(ctx.db, feed);

    // The daily row is present before the full history resolves.
    expect(await ctx.db.select().from(fxRateDaily)).toHaveLength(1);
    expect(fetchFullHistory).toHaveBeenCalled();

    releaseFull([day("2026-08-05", "1.1700"), day("2026-08-06", "1.1600")]);
    await vi.waitFor(async () => {
      expect(await ctx.db.select().from(fxRateDaily)).toHaveLength(3);
    });
  });

  it("does not refetch when storage is current and the history is there", async () => {
    await storeRateDays(ctx.db, [day(COVERED_FROM, "1.1800"), day(daysAgo(0), "1.1535")]);
    const feed = { fetchDaily: vi.fn(), fetchRecent: vi.fn(), fetchFullHistory: vi.fn() };
    await ensureRatesAvailable(ctx.db, feed);
    expect(feed.fetchDaily).not.toHaveBeenCalled();
    expect(feed.fetchRecent).not.toHaveBeenCalled();
    expect(feed.fetchFullHistory).not.toHaveBeenCalled();
  });

  it("re-seeds the full history when an earlier seed left only recent rows", async () => {
    // The state an interrupted seed leaves: the blocking daily feed landed,
    // the 951 KB history behind it did not. `max(date)` is today, so feed
    // choice by tail alone sees nothing to do — forever.
    await storeRateDays(ctx.db, [day(daysAgo(0), "1.1535")]);

    const fetchFullHistory = vi
      .fn()
      .mockResolvedValue([day(COVERED_FROM, "1.1800"), day(daysAgo(1), "1.1600")]);
    const feed = { fetchDaily: vi.fn(), fetchRecent: vi.fn(), fetchFullHistory };

    await ensureRatesAvailable(ctx.db, feed);

    await vi.waitFor(() => expect(fetchFullHistory).toHaveBeenCalledTimes(1));
    // Spot rates already exist, so nothing needed refetching on the tail.
    expect(feed.fetchDaily).not.toHaveBeenCalled();
    expect(feed.fetchRecent).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await earliestStoredDate(ctx.db)).toBe(COVERED_FROM));
  });

  it("runs the recovery seed in the background, never blocking the caller", async () => {
    // One of these calls is awaited during boot. A 951 KB fetch plus a
    // 220k-row insert must not be on that path.
    await storeRateDays(ctx.db, [day(daysAgo(0), "1.1535")]);
    let releaseFull: (value: RateDay[]) => void = () => {};
    const fullPromise = new Promise<RateDay[]>((resolve) => (releaseFull = resolve));
    const feed = {
      fetchDaily: vi.fn(),
      fetchRecent: vi.fn(),
      fetchFullHistory: vi.fn().mockReturnValue(fullPromise),
    };

    await ensureRatesAvailable(ctx.db, feed); // resolves while the seed is still pending
    expect(feed.fetchFullHistory).toHaveBeenCalled();
    expect(await earliestStoredDate(ctx.db)).toBe(daysAgo(0));

    releaseFull([day(COVERED_FROM, "1.1800")]);
    await vi.waitFor(async () => expect(await earliestStoredDate(ctx.db)).toBe(COVERED_FROM));
  });

  it("does not wedge when the full-history fetch throws synchronously", async () => {
    // `RateFeed` permits a synchronous throw. Thrown outside the promise
    // chain it escapes the handler that clears `inFlight`, and every future
    // refresh in this process is dead.
    const fetchDaily = vi.fn().mockResolvedValue([]); // stores nothing: table stays empty
    const fetchFullHistory = vi.fn(() => {
      throw new Error("sync boom");
    });
    const feed = { fetchDaily, fetchRecent: vi.fn(), fetchFullHistory };

    await ensureRatesAvailable(ctx.db, feed);

    // The table is still empty, so the throttle does not apply and a second
    // call must attempt the seed again -- which it can only do if `inFlight`
    // was released.
    await ensureRatesAvailable(ctx.db, feed);
    expect(fetchDaily).toHaveBeenCalledTimes(2);
  });

  it("releases inFlight when the daily fetch rejects, so a later call retries", async () => {
    const fetchDaily = vi.fn().mockRejectedValueOnce(new Error("network blip"));
    const feed = { fetchDaily, fetchRecent: vi.fn(), fetchFullHistory: vi.fn() };

    await expect(ensureRatesAvailable(ctx.db, feed)).rejects.toThrow("network blip");
    expect(fetchDaily).toHaveBeenCalledTimes(1);

    // Table is still empty (the failed attempt never stored anything), so a
    // later call should attempt the daily fetch again -- proving `inFlight`
    // was released rather than left permanently wedged.
    fetchDaily.mockResolvedValueOnce([day("2026-08-07", "1.1535")]);
    const fetchFullHistory = vi.fn().mockResolvedValue([]);
    await ensureRatesAvailable(ctx.db, { fetchDaily, fetchRecent: vi.fn(), fetchFullHistory });

    expect(fetchDaily).toHaveBeenCalledTimes(2);
  });

  it("does not seed twice when two calls race on an empty table", async () => {
    const fetchDaily = vi.fn().mockResolvedValue([day("2026-08-07", "1.1535")]);
    const fetchFullHistory = vi.fn().mockResolvedValue([day("2026-08-06", "1.1600")]);
    const feed = { fetchDaily, fetchRecent: vi.fn(), fetchFullHistory };

    await Promise.all([ensureRatesAvailable(ctx.db, feed), ensureRatesAvailable(ctx.db, feed)]);
    await vi.waitFor(() => expect(fetchFullHistory).toHaveBeenCalledTimes(1));

    expect(fetchDaily).toHaveBeenCalledTimes(1);
  });
});
