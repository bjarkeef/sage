import { describe, it, expect } from "vitest";
import { YahooFinanceProvider } from "./provider";

/**
 * Talks to the REAL Yahoo Finance. Never part of `pnpm test`: it needs the
 * network, it is not deterministic, and a PR must not go red because an
 * upstream had a bad minute.
 *
 * It exists because the mocked suite cannot tell "our mapping is correct" from
 * "the provider still answers the phone". On 2026-08-09 all 1,238 mocked tests
 * passed while every quote in the app was failing.
 */
describe("Yahoo Finance (live)", () => {
  const provider = new YahooFinanceProvider();

  it("returns a quote", async () => {
    const quote = await provider.getQuote("AAPL");
    expect(quote.symbol).toBe("AAPL");
    expect(quote.price.currency).toBe("USD");
    expect(Number(quote.price.amount)).toBeGreaterThan(0);
  });

  it("returns a year of daily bars", async () => {
    const to = new Date();
    const from = new Date(Date.now() - 365 * 86_400_000);
    const bars = await provider.getHistoricalPrices("AAPL", from, to);
    // ~252 trading days a year; 200 is slack for holidays without being vacuous.
    expect(bars.length).toBeGreaterThan(200);
    expect(Number(bars[0]!.close.amount)).toBeGreaterThan(0);
  });

  it("returns dividend history", async () => {
    const dividends = await provider.getDividendHistory("O");
    // O pays monthly and has for decades — really returns ~360 dividends. A
    // floor of 50 would miss a silent upstream truncation to a few years.
    expect(dividends.length).toBeGreaterThan(300);
    expect(Number(dividends[0]!.amountPerShare.amount)).toBeGreaterThan(0);
  });

  it("returns an asset profile with a sector", async () => {
    const profile = await provider.getAssetProfile("O");
    expect(profile.name).toBeTruthy();
    expect(profile.sector).toBeTruthy();
  });

  it("resolves a non-US symbol, so exchange suffixes still work", async () => {
    // The only file in the repo that may name real tickers: it asks the real
    // Yahoo whether a symbol resolves, and an invented one would fail for the
    // uninteresting reason that it does not exist. They are chosen to be
    // household mega-caps rather than anything a maintainer happens to hold —
    // VOLV-B.ST doubles as coverage for a hyphen alongside a suffix.
    const quote = await provider.getQuote("VOLV-B.ST");
    expect(quote.price.currency).toBe("SEK");
    expect(Number(quote.price.amount)).toBeGreaterThan(0);
  });
});
