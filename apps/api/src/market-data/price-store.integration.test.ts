import { it, expect, beforeAll, afterAll } from "vitest";
import { Money, Decimal } from "@sage/core";
import type { PriceBar, Quote } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { PriceStore } from "./price-store";

const NOW = new Date();
const dayOffset = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

function bar(date: Date, close: string, currency = "USD"): PriceBar {
  return {
    date,
    open: Money.of(close, currency),
    high: Money.of(close, currency),
    low: Money.of(close, currency),
    close: Money.of(close, currency),
    volume: new Decimal("1000"),
  };
}

function quote(symbol: string, price: string, currency = "USD"): Quote {
  return {
    symbol,
    price: Money.of(price, currency),
    asOf: NOW,
    previousClose: Money.of("99.5", currency),
  };
}

describeDb("PriceStore", () => {
  let t: TestDb;
  let store: PriceStore;

  beforeAll(async () => {
    t = await withTestDb();
    store = new PriceStore(t.db);
  });

  afterAll(async () => {
    await t.stop();
  });

  it("round-trips a quote without losing decimal precision", async () => {
    // 18 significant digits — float64 cannot represent this exactly, and unlike
    // 17-digit values it doesn't round-trip via toString() either, so a
    // Number()/parseFloat corruption would actually be caught here. Verified:
    // Number("123.456789012345678").toString() === "123.45678901234568" (!== original).
    await store.writeQuote(quote("PREC", "123.456789012345678"), NOW);
    const stored = await store.readQuote("PREC");
    expect(stored).not.toBeNull();
    expect(stored!.quote.price.amount.toString()).toBe("123.456789012345678");
    expect(stored!.quote.price.currency).toBe("USD");
    expect(stored!.quote.previousClose?.amount.toString()).toBe("99.5");
  });

  it("returns null for a symbol it has never seen", async () => {
    expect(await store.readQuote("NEVER")).toBeNull();
  });

  it("overwrites rather than duplicating on re-write", async () => {
    await store.writeQuote(quote("DUP", "10"), NOW);
    await store.writeQuote(quote("DUP", "20"), NOW);
    const stored = await store.readQuote("DUP");
    expect(stored!.quote.price.amount.toString()).toBe("20");
  });

  it("preserves a null previousClose", async () => {
    const q = { ...quote("NOPREV", "5"), previousClose: null };
    await store.writeQuote(q, NOW);
    const stored = await store.readQuote("NOPREV");
    expect(stored!.quote.previousClose).toBeNull();
  });

  it("keeps the newer price when an older write arrives after it", async () => {
    const symbol = "ORDER1";
    const newer = new Date(NOW.getTime());
    const older = new Date(NOW.getTime() - 60_000);

    // Simulates two overlapping background refreshes resolving out of order:
    // the one carrying the newer `as_of` writes first, then a straggler
    // carrying an older `as_of` and a different price arrives after it.
    await store.writeQuote({ ...quote(symbol, "100"), asOf: newer }, NOW);
    await store.writeQuote({ ...quote(symbol, "50"), asOf: older }, NOW);

    const stored = await store.readQuote(symbol);
    expect(stored!.quote.price.amount.toString()).toBe("100");
  });

  it("advances fetchedAt even when the losing write carries an older as_of", async () => {
    // `fetchedAt` means "when we last reached the provider" — a fact about our
    // clock, independent of whose observation won. Gating the whole DO UPDATE
    // on `as_of` froze it, and since `as_of` is NOT monotonic across providers
    // (Yahoo's mapper falls back to `new Date()`; EODHD reports a trade
    // timestamp; a Yahoo fallback sits behind every non-Yahoo primary) one
    // future-ish timestamp froze the row permanently —
    // the UI reporting prices as days old while every provider read healthy.
    const symbol = "ORDER3";
    const firstFetch = new Date(NOW.getTime() - 120_000);
    const secondFetch = new Date(NOW.getTime());

    await store.writeQuote({ ...quote(symbol, "100"), asOf: NOW }, firstFetch);
    await store.writeQuote(
      { ...quote(symbol, "50"), asOf: new Date(NOW.getTime() - 60_000) },
      secondFetch,
    );

    const stored = await store.readQuote(symbol);
    // The stale observation still loses the price...
    expect(stored!.quote.price.amount.toString()).toBe("100");
    expect(stored!.quote.asOf.getTime()).toBe(NOW.getTime());
    // ...but the fetch clock moved, because we DID reach the provider.
    expect(Math.abs(stored!.fetchedAt.getTime() - secondFetch.getTime())).toBeLessThan(2000);
  });

  it("still refreshes fetchedAt when as_of repeats unchanged", async () => {
    // A provider legitimately repeats an unchanged `as_of` after market
    // close. That write must still count as a fresh fetch, which is why the
    // guard is `>=` and not `>`.
    const symbol = "ORDER2";
    const asOf = new Date(NOW.getTime());
    const firstFetch = new Date(NOW.getTime() - 120_000);
    const secondFetch = new Date(NOW.getTime());

    await store.writeQuote({ ...quote(symbol, "100"), asOf }, firstFetch);
    await store.writeQuote({ ...quote(symbol, "100"), asOf }, secondFetch);

    const stored = await store.readQuote(symbol);
    expect(Math.abs(stored!.fetchedAt.getTime() - secondFetch.getTime())).toBeLessThan(2000);
  });

  it("round-trips bars in date order within the requested window", async () => {
    await store.writeBars(
      "BARS",
      [bar(dayOffset(-2), "3"), bar(dayOffset(-10), "1"), bar(dayOffset(-5), "2")],
      NOW,
    );
    const bars = await store.readBars("BARS", dayOffset(-30), dayOffset(0));
    expect(bars.map((b) => b.close.amount.toString())).toEqual(["1", "2", "3"]);
    expect(bars[0]!.volume.toString()).toBe("1000");
  });

  it("writeBars overwrites rather than duplicating on re-write for the same day", async () => {
    const day = dayOffset(-3);
    const laterNow = new Date(NOW.getTime() + 5000);
    await store.writeBars("IDEMP_BARS", [bar(day, "1")], NOW);
    await store.writeBars("IDEMP_BARS", [bar(day, "2")], laterNow);

    const bars = await store.readBars("IDEMP_BARS", dayOffset(-30), dayOffset(0));
    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toString()).toBe("2");

    const cov = await store.coverage("IDEMP_BARS");
    expect(cov).not.toBeNull();
    expect(Math.abs(cov!.newestFetchedAt.getTime() - laterNow.getTime())).toBeLessThan(2000);
  });

  // Postgres caps a statement at 65,535 bind parameters and `price_daily` binds
  // 9 per row, so a single INSERT tops out at 7,281 bars — under 30 years. A
  // plain `range=ALL` fetch of an old symbol clears that (AAPL is ~11,300 bars)
  // and threw a non-SymbolNotFoundError that both catch blocks swallowed: no
  // rows stored, coverage still null, so every later request retook the cold
  // blocking path — a permanent full-history refetch loop against a
  // 20-requests-per-day tier, with nothing logged.
  //
  // The heaviest test in the suite, and the one that exposed vitest's 5s
  // default as wrong for DB-backed tests (see testTimeout in vitest.config.ts).
  // The bar count is load-bearing — it has to clear 7,281 — so it does not get
  // shrunk to buy speed.
  it("writes a bar count that exceeds one statement's bind-parameter limit", async () => {
    const count = 7500;
    const bars = Array.from({ length: count }, (_, i) => bar(dayOffset(-i), String(i + 1)));

    await store.writeBars("BULK", bars, NOW);

    const read = await store.readBars("BULK", dayOffset(-count), dayOffset(0));
    expect(read).toHaveLength(count);
    // Chunk boundaries are the interesting part: first, last, and either side
    // of the 2000-row seam.
    expect(read[0]!.close.amount.toString()).toBe(String(count));
    expect(read[count - 1]!.close.amount.toString()).toBe("1");
    const cov = await store.coverage("BULK");
    expect(cov!.earliest).toBe(
      dayOffset(-(count - 1))
        .toISOString()
        .slice(0, 10),
    );
    expect(cov!.latest).toBe(dayOffset(0).toISOString().slice(0, 10));
  });

  it("excludes bars outside the requested window", async () => {
    await store.writeBars("WINDOW", [bar(dayOffset(-40), "1"), bar(dayOffset(-2), "2")], NOW);
    const bars = await store.readBars("WINDOW", dayOffset(-30), dayOffset(0));
    expect(bars).toHaveLength(1);
    expect(bars[0]!.close.amount.toString()).toBe("2");
  });

  it("reports coverage endpoints and the newest fetch", async () => {
    await store.writeBars("COV", [bar(dayOffset(-9), "1"), bar(dayOffset(-1), "2")], NOW);
    const cov = await store.coverage("COV");
    expect(cov).not.toBeNull();
    expect(cov!.earliest).toBe(dayOffset(-9).toISOString().slice(0, 10));
    expect(cov!.latest).toBe(dayOffset(-1).toISOString().slice(0, 10));
    expect(cov!.newestFetchedAt.getTime()).toBeGreaterThan(0);
  });

  it("reports null coverage for an unknown symbol", async () => {
    expect(await store.coverage("UNKNOWN_COV")).toBeNull();
  });

  it("keeps each bar's own currency", async () => {
    await store.writeBars("GBP", [bar(dayOffset(-1), "7", "GBP")], NOW);
    const bars = await store.readBars("GBP", dayOffset(-30), dayOffset(0));
    expect(bars[0]!.close.currency).toBe("GBP");
  });

  it("finds the oldest fetch across the given symbols", async () => {
    const old = new Date(NOW.getTime() - 5 * 86_400_000);
    await store.writeQuote(quote("OLDA", "1"), old);
    await store.writeQuote(quote("NEWB", "2"), NOW);
    const oldest = await store.oldestQuoteFetch(["OLDA", "NEWB"]);
    expect(oldest).not.toBeNull();
    expect(Math.abs(oldest!.getTime() - old.getTime())).toBeLessThan(2000);
  });

  it("returns null oldest fetch when no symbol is stored", async () => {
    expect(await store.oldestQuoteFetch(["ABSENT_1", "ABSENT_2"])).toBeNull();
  });

  // An empty list must not become `WHERE symbol IN ()`, which is a SQL error.
  it("returns null oldest fetch for an empty symbol list", async () => {
    expect(await store.oldestQuoteFetch([])).toBeNull();
  });

  it("counts only the symbols with no stored quote", async () => {
    await store.writeQuote(quote("MISS_HAVE", "1"), NOW);
    expect(await store.countMissingQuotes(["MISS_HAVE", "MISS_GONE1", "MISS_GONE2"])).toBe(2);
    expect(await store.countMissingQuotes(["MISS_HAVE"])).toBe(0);
    // Deduplicated, so a repeated symbol cannot inflate the count.
    expect(await store.countMissingQuotes(["MISS_GONE1", "MISS_GONE1"])).toBe(1);
    expect(await store.countMissingQuotes([])).toBe(0);
  });
});
