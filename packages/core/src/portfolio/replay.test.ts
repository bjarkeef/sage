import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import { replayHoldings, replayConvertedInvested } from "./replay";
import type { PositionTransaction } from "./positions";

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
    tradeDate: new Date(date),
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
    tradeDate: new Date(date),
  };
}
function dividend(
  symbol: string,
  amountPerShare: string,
  sharesHeld: string,
  date: string,
  ccy = "USD",
): PositionTransaction {
  return {
    symbol,
    type: "dividend",
    quantity: new Decimal(sharesHeld),
    price: Money.of(amountPerShare, ccy),
    tradeDate: new Date(date),
  };
}
function split(symbol: string, multiplier: string, date: string, ccy = "USD"): PositionTransaction {
  return {
    symbol,
    type: "split",
    quantity: new Decimal(multiplier),
    price: Money.of("0", ccy),
    tradeDate: new Date(date),
  };
}

describe("replayHoldings", () => {
  it("buy on D1: asOf(D1) shows the holding, asOf(D0) is empty", () => {
    const timeline = replayHoldings([buy("AAPL", "10", "100", "2026-01-01")]);

    const d1 = timeline.asOf("2026-01-01");
    expect(d1.quantities.get("AAPL")?.toFixed()).toBe("10");
    expect(d1.invested.get("USD")?.toFixed()).toBe("1000");

    const d0 = timeline.asOf("2025-12-31");
    expect(d0.quantities.get("AAPL")).toBeUndefined();
    expect(d0.invested.size).toBe(0);
  });

  it("buy then sell: quantity and invested net down", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      sell("AAPL", "4", "110", "2026-01-02"),
    ]);

    const snap = timeline.asOf("2026-01-02");
    expect(snap.quantities.get("AAPL")?.toFixed()).toBe("6");
    // 1000 - 440 = 560
    expect(snap.invested.get("USD")?.toFixed()).toBe("560");
  });

  it("2:1 split doubles quantity, leaves invested unchanged", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      split("AAPL", "2", "2026-01-02"),
    ]);

    const snap = timeline.asOf("2026-01-02");
    expect(snap.quantities.get("AAPL")?.toFixed()).toBe("20");
    expect(snap.invested.get("USD")?.toFixed()).toBe("1000");
  });

  it("dividend transaction has no effect on quantities or invested", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      dividend("AAPL", "0.25", "10", "2026-02-01"),
    ]);

    const snap = timeline.asOf("2026-02-01");
    expect(snap.quantities.get("AAPL")?.toFixed()).toBe("10");
    expect(snap.invested.get("USD")?.toFixed()).toBe("1000");
  });

  it("keys invested per currency across two currencies; currencyOf returns first-tx currency", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01", "USD"),
      buy("ALBION", "5", "50", "2026-01-02", "GBP"),
    ]);

    const snap = timeline.asOf("2026-01-02");
    expect(snap.invested.get("USD")?.toFixed()).toBe("1000");
    expect(snap.invested.get("GBP")?.toFixed()).toBe("250");
    expect(timeline.currencyOf("AAPL")).toBe("USD");
    expect(timeline.currencyOf("ALBION")).toBe("GBP");
  });

  it("tracks per-symbol invested: buys add, sells subtract, in the symbol's own currency", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      sell("AAPL", "4", "110", "2026-01-02"),
    ]);

    const d1 = timeline.asOf("2026-01-01");
    expect(d1.investedBySymbol.get("AAPL")?.toFixed()).toBe("1000");

    const d2 = timeline.asOf("2026-01-02");
    // 1000 − 4×110 = 560, mirroring the per-currency invested
    expect(d2.investedBySymbol.get("AAPL")?.toFixed()).toBe("560");
    expect(d2.invested.get("USD")?.toFixed()).toBe("560");
  });

  it("splits and dividends leave per-symbol invested unchanged", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      split("AAPL", "2", "2026-01-02"),
      dividend("AAPL", "0.25", "20", "2026-02-01"),
    ]);
    const snap = timeline.asOf("2026-02-01");
    expect(snap.investedBySymbol.get("AAPL")?.toFixed()).toBe("1000");
  });

  it("keeps two same-currency symbols in separate per-symbol invested buckets", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01", "USD"),
      buy("MSFT", "5", "200", "2026-01-02", "USD"),
    ]);

    const snap = timeline.asOf("2026-01-02");
    expect(snap.investedBySymbol.get("AAPL")?.toFixed()).toBe("1000");
    expect(snap.investedBySymbol.get("MSFT")?.toFixed()).toBe("1000");
    // the per-currency bucket sums both
    expect(snap.invested.get("USD")?.toFixed()).toBe("2000");
  });

  it("firstTransactionDate is the earliest tradeDate as YYYY-MM-DD; null for []", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-15"),
      buy("MSFT", "5", "200", "2026-01-02"),
    ]);
    expect(timeline.firstTransactionDate).toBe("2026-01-02");

    const empty = replayHoldings([]);
    expect(empty.firstTransactionDate).toBeNull();
    expect(empty.symbols).toEqual([]);
  });

  it("asOf between transaction dates returns the earlier (step function) snapshot", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("AAPL", "5", "120", "2026-01-10"),
    ]);

    const mid = timeline.asOf("2026-01-05");
    expect(mid.quantities.get("AAPL")?.toFixed()).toBe("10");
    expect(mid.invested.get("USD")?.toFixed()).toBe("1000");

    const after = timeline.asOf("2026-01-10");
    expect(after.quantities.get("AAPL")?.toFixed()).toBe("15");
    expect(after.invested.get("USD")?.toFixed()).toBe("1600");
  });

  it("lists every symbol ever transacted", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("MSFT", "5", "200", "2026-01-02"),
      sell("AAPL", "10", "110", "2026-01-03"),
    ]);
    expect(timeline.symbols.sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("folds multiple same-date transactions into one snapshot", () => {
    const timeline = replayHoldings([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("AAPL", "5", "100", "2026-01-01"),
      sell("AAPL", "3", "100", "2026-01-01"),
    ]);
    const snap = timeline.asOf("2026-01-01");
    expect(snap.quantities.get("AAPL")?.toFixed()).toBe("12");
    expect(snap.invested.get("USD")?.toFixed()).toBe("1200");
  });

  it("answers dates after the last transaction and protects internal state from mutation", () => {
    const timeline = replayHoldings([buy("AAPL", "10", "100", "2026-01-01")]);

    const later = timeline.asOf("2030-12-31");
    expect(later.quantities.get("AAPL")?.toFixed()).toBe("10");

    later.quantities.set("AAPL", new Decimal(999));
    later.invested.set("USD", new Decimal(0));
    later.investedBySymbol.set("AAPL", new Decimal(0));
    const fresh = timeline.asOf("2030-12-31");
    expect(fresh.quantities.get("AAPL")?.toFixed()).toBe("10");
    expect(fresh.invested.get("USD")?.toFixed()).toBe("1000");
    expect(fresh.investedBySymbol.get("AAPL")?.toFixed()).toBe("1000");
  });
});

describe("replayConvertedInvested", () => {
  /** USD per 1 EUR: 1.03 up to 2026-02-28, 1.15 from 2026-03-01. */
  const eurRates = (date: string, currency: string): Decimal | null => {
    if (currency === "EUR") return new Decimal(1);
    if (currency !== "USD") return null;
    return new Decimal(date < "2026-03-01" ? "1.03" : "1.15");
  };

  it("holds a past purchase at the rate of the day it was paid", () => {
    const invested = replayConvertedInvested([buy("AAPL", "10", "100", "2026-01-15")], eurRates);

    // $1000 at 1.03. The rate moves to 1.15 in March and the answer must not:
    // converting the cumulative native total per date would report 869.57.
    expect(invested.investedOn("AAPL", "2026-01-15")?.toFixed(2)).toBe("970.87");
    expect(invested.investedOn("AAPL", "2026-06-30")?.toFixed(2)).toBe("970.87");
  });

  it("converts each flow at its own date, so a later buy uses a later rate", () => {
    const invested = replayConvertedInvested(
      [buy("AAPL", "10", "100", "2026-01-15"), buy("AAPL", "10", "100", "2026-04-15")],
      eurRates,
    );

    expect(invested.investedOn("AAPL", "2026-01-15")?.toFixed(2)).toBe("970.87");
    // 1000/1.03 + 1000/1.15 — not 2000 at either single rate.
    expect(invested.investedOn("AAPL", "2026-04-15")?.toFixed(2)).toBe("1840.44");
  });

  it("subtracts sells at the sell date's rate and ignores splits and dividends", () => {
    const invested = replayConvertedInvested(
      [
        buy("AAPL", "10", "100", "2026-01-15"),
        split("AAPL", "2", "2026-02-01"),
        dividend("AAPL", "1", "20", "2026-02-10"),
        sell("AAPL", "5", "115", "2026-04-15"),
      ],
      eurRates,
    );

    // Splits and dividends move no cost basis, exactly as replayHoldings treats
    // them; the sell nets off at April's 1.15 → 970.87 - 500 = 470.87.
    expect(invested.investedOn("AAPL", "2026-02-10")?.toFixed(2)).toBe("970.87");
    expect(invested.investedOn("AAPL", "2026-04-15")?.toFixed(2)).toBe("470.87");
  });

  it("collapses same-day flows into one end-of-day figure", () => {
    const invested = replayConvertedInvested(
      [buy("AAPL", "10", "100", "2026-01-15"), buy("AAPL", "5", "100", "2026-01-15")],
      eurRates,
    );

    expect(invested.investedOn("AAPL", "2026-01-15")?.toFixed(2)).toBe("1456.31");
  });

  it("reports nothing before the first flow, and nothing for an unknown symbol", () => {
    const invested = replayConvertedInvested([buy("AAPL", "10", "100", "2026-01-15")], eurRates);

    expect(invested.investedOn("AAPL", "2026-01-14")).toBeNull();
    expect(invested.investedOn("MSFT", "2026-06-30")).toBeNull();
  });

  it("withholds a symbol's whole cost when any one flow cannot be priced", () => {
    const invested = replayConvertedInvested(
      [
        buy("NORDA", "10", "600", "2026-01-15", "DKK"), // unpriceable by eurRates
        buy("AAPL", "10", "100", "2026-01-15"),
      ],
      eurRates,
    );

    // A cost basis missing one of its purchases would be silently understated,
    // so the symbol is withheld outright. Priceable symbols are unaffected.
    expect(invested.unconvertible.has("NORDA")).toBe(true);
    expect(invested.investedOn("NORDA", "2026-06-30")).toBeNull();
    expect(invested.investedOn("AAPL", "2026-06-30")?.toFixed(2)).toBe("970.87");
  });

  it("returns the native figures when every rate is 1", () => {
    const invested = replayConvertedInvested(
      [buy("AAPL", "10", "100", "2026-01-01"), sell("AAPL", "4", "110", "2026-01-02")],
      () => new Decimal(1),
    );

    // Same book as the replayHoldings "buy then sell" case above: 1000 - 440.
    expect(invested.investedOn("AAPL", "2026-01-02")?.toFixed()).toBe("560");
  });

  it("sorts internally rather than trusting the caller's array order", () => {
    const invested = replayConvertedInvested(
      [buy("AAPL", "10", "100", "2026-04-15"), buy("AAPL", "10", "100", "2026-01-15")],
      eurRates,
    );

    // The January buy must not pick up April's rate just by arriving second.
    expect(invested.investedOn("AAPL", "2026-01-15")?.toFixed(2)).toBe("970.87");
    expect(invested.investedOn("AAPL", "2026-04-15")?.toFixed(2)).toBe("1840.44");
  });
});
