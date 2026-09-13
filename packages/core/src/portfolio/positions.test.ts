import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import { computePositions, type PositionTransaction } from "./positions";
import { OversellError } from "./errors";

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

describe("computePositions", () => {
  it("returns an empty list for no transactions", () => {
    expect(computePositions([])).toEqual([]);
  });

  it("orders same-type same-day trades by sequence (FIFO lot order)", () => {
    // Two same-day buys; sequence "a" before "b" so the 100 lot is older.
    const laterListed = buy("AAPL", "10", "120", "2026-01-01T00:00:00Z");
    laterListed.sequence = "b";
    const earlierListed = buy("AAPL", "10", "100", "2026-01-01T00:00:00Z");
    earlierListed.sequence = "a";
    const result = computePositions([
      laterListed,
      earlierListed,
      sell("AAPL", "10", "130", "2026-01-02T00:00:00Z"),
    ]);
    expect(result).toHaveLength(1);
    // FIFO consumed the sequence-"a" lot @100, leaving 10@120.
    expect(result[0]!.costBasis.toString()).toBe("1200");
  });

  it("prefers buy before sell on the same day even when sequence would reverse them", () => {
    // Bulk imports often stamp every row with the same createdAt; UUID
    // sequence alone can then put a same-day sell before its buy.
    // Held before 2026-05-11 = 10; same-day buy 5 is required before sell 15.
    const prior = buy("CASH", "10", "1", "2026-05-09T00:00:00Z", "GBP");
    prior.sequence = "2026-07-19T11:09:00.676Z|aaaa";
    const sameDaySell = sell("CASH", "15", "1", "2026-05-11T00:00:00Z", "GBP");
    sameDaySell.sequence = "2026-07-19T11:09:00.676Z|241819cb"; // sorts before buy by UUID
    const sameDayBuy = buy("CASH", "5", "1", "2026-05-11T00:00:00Z", "GBP");
    sameDayBuy.sequence = "2026-07-19T11:09:00.676Z|f7a5d890";

    // Type order applies the buy first → no OversellError; position fully closed.
    expect(computePositions([sameDaySell, sameDayBuy, prior])).toEqual([]);
  });

  it("averages cost over multiple buys", () => {
    const result = computePositions([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("AAPL", "10", "120", "2026-01-02"),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("20");
    expect(p.costBasis.toString()).toBe("2200");
    expect(p.averageCost.toString()).toBe("110");
    expect(p.currency).toBe("USD");
  });

  it("consumes oldest lots first on a sell (FIFO)", () => {
    // Buy 10@100 then 10@120, sell 15. FIFO drops all of lot1 (10@100) and 5 of lot2 (5@120).
    // Remaining: 5 shares @120 => costBasis 600.
    const result = computePositions([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("AAPL", "10", "120", "2026-01-02"),
      sell("AAPL", "15", "130", "2026-01-03"),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("5");
    expect(p.costBasis.toString()).toBe("600");
    expect(p.averageCost.toString()).toBe("120");
  });

  it("excludes fully-closed positions", () => {
    expect(
      computePositions([
        buy("AAPL", "5", "100", "2026-01-01"),
        sell("AAPL", "5", "110", "2026-01-02"),
      ]),
    ).toEqual([]);
  });

  it("excludes residual dust after near-equal buy/sell totals", () => {
    // Import residue: sells leave 1e-8 units — not a real open holding.
    expect(
      computePositions([
        buy("CASH", "1981.52647945", "1", "2026-01-01", "GBP"),
        sell("CASH", "1981.52647944", "1", "2026-05-11", "GBP"),
      ]),
    ).toEqual([]);
  });

  it("supports fractional shares", () => {
    const result = computePositions([buy("GLOBIX", "1.5", "100", "2026-01-01")]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("1.5");
    expect(p.costBasis.toString()).toBe("150");
  });

  it("orders by trade date regardless of input order", () => {
    const result = computePositions([
      buy("AAPL", "10", "120", "2026-01-02"),
      buy("AAPL", "10", "100", "2026-01-01"),
      sell("AAPL", "10", "130", "2026-01-03"),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    // Earliest lot (100) is sold first, leaving 10@120.
    expect(p.costBasis.toString()).toBe("1200");
  });

  it("groups independent symbols", () => {
    const result = computePositions([
      buy("AAPL", "1", "100", "2026-01-01"),
      buy("MSFT", "2", "200", "2026-01-01"),
    ]);
    expect(result.map((p) => p.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("throws OversellError when selling more than held", () => {
    expect(() =>
      computePositions([
        buy("AAPL", "5", "100", "2026-01-01"),
        sell("AAPL", "6", "110", "2026-01-02"),
      ]),
    ).toThrow(OversellError);
  });
});

describe("dividends", () => {
  it("skips dividends — no effect on position quantity or cost basis", () => {
    const result = computePositions([
      buy("AAPL", "10", "100", "2026-01-01"),
      dividend("AAPL", "0.25", "10", "2026-03-15"),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("10");
    expect(p.costBasis.toDecimal().toFixed()).toBe("1000");
  });

  it("dividend-only transactions produce no position", () => {
    const result = computePositions([dividend("AAPL", "0.25", "10", "2026-03-15")]);
    expect(result).toEqual([]);
  });
});

describe("splits", () => {
  it("multiplies lot quantities by the split factor", () => {
    const result = computePositions([
      buy("AAPL", "10", "150", "2026-01-01"),
      split("AAPL", "4", "2026-06-01"),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("40");
  });

  it("preserves total cost basis through a split", () => {
    const result = computePositions([
      buy("AAPL", "10", "150", "2026-01-01"),
      split("AAPL", "4", "2026-06-01"),
    ]);
    const p = result[0]!;
    expect(p.costBasis.toDecimal().toFixed()).toBe("1500");
    expect(p.averageCost.toDecimal().toFixed(2)).toBe("37.50");
  });

  it("handles reverse split (multiplier < 1)", () => {
    const result = computePositions([
      buy("AAPL", "100", "10", "2026-01-01"),
      split("AAPL", "0.1", "2026-06-01"),
    ]);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("10");
    expect(p.costBasis.toDecimal().toFixed()).toBe("1000");
    expect(p.averageCost.toDecimal().toFixed()).toBe("100");
  });

  it("applies split to multiple lots", () => {
    const result = computePositions([
      buy("AAPL", "10", "100", "2026-01-01"),
      buy("AAPL", "5", "120", "2026-02-01"),
      split("AAPL", "2", "2026-06-01"),
    ]);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("30");
    expect(p.costBasis.toDecimal().toFixed()).toBe("1600");
  });

  it("applies split between buys and sells correctly", () => {
    const result = computePositions([
      buy("AAPL", "10", "100", "2026-01-01"),
      split("AAPL", "2", "2026-03-01"),
      sell("AAPL", "5", "55", "2026-04-01"),
    ]);
    const p = result[0]!;
    expect(p.quantity.toFixed()).toBe("15");
  });
});

describe("computePositions — acquisition fees", () => {
  const withFee = (tx: PositionTransaction, amount: string, ccy = "USD"): PositionTransaction => ({
    ...tx,
    fee: Money.of(amount, ccy),
  });

  // Fees were recorded from the first import and read by nothing: every figure
  // built on cost basis assumed the shares had been free to buy. On the
  // reporting book that overstated the unrealised gain by 104.56 DKK, 3% of the
  // gain being reported.
  it("counts a buy's fee as part of what the shares cost", () => {
    const [p] = computePositions([withFee(buy("AAPL", "10", "100", "2024-01-01"), "25")]);

    expect(p!.costBasis.amount.toString()).toBe("1025");
    expect(p!.averageCost.amount.toString()).toBe("102.5");
  });

  it("leaves a position without fees exactly where it was", () => {
    const [p] = computePositions([buy("AAPL", "10", "100", "2024-01-01")]);
    expect(p!.costBasis.amount.toString()).toBe("1000");
  });

  it("carries the fee through a partial sell in proportion to the shares left", () => {
    const [p] = computePositions([
      withFee(buy("AAPL", "10", "100", "2024-01-01"), "25"),
      sell("AAPL", "4", "150", "2024-06-01"),
    ]);

    // 6 of 10 shares survive, each costing 102.5 to acquire.
    expect(p!.quantity.toString()).toBe("6");
    expect(p!.costBasis.amount.toString()).toBe("615");
  });

  it("keeps fee-inclusive basis whole across a split", () => {
    const [p] = computePositions([
      withFee(buy("AAPL", "10", "100", "2024-01-01"), "25"),
      { ...buy("AAPL", "2", "0", "2024-06-01"), type: "split" },
    ]);

    expect(p!.quantity.toString()).toBe("20");
    expect(p!.costBasis.amount.toString()).toBe("1025");
    expect(p!.averageCost.amount.toString()).toBe("51.25");
  });

  // A sell's fee reduces the proceeds, which is a realised figure. The lots
  // that survive were bought at the same cost either way.
  it("ignores a sell's own fee", () => {
    const [p] = computePositions([
      buy("AAPL", "10", "100", "2024-01-01"),
      withFee(sell("AAPL", "4", "150", "2024-06-01"), "30"),
    ]);

    expect(p!.costBasis.amount.toString()).toBe("600");
  });

  // Core holds no exchange rates, so the alternative to dropping it is adding
  // a DKK figure to a USD one. The loader converts at the trade date before
  // this point; see `feeInTradeCurrency`.
  it("drops a fee it cannot convert rather than adding it wrong", () => {
    const [p] = computePositions([withFee(buy("AAPL", "10", "100", "2024-01-01"), "90", "DKK")]);

    expect(p!.costBasis.amount.toString()).toBe("1000");
    expect(p!.costBasis.currency).toBe("USD");
  });

  it("treats a zero fee as no fee", () => {
    const [p] = computePositions([withFee(buy("AAPL", "10", "100", "2024-01-01"), "0")]);
    expect(p!.costBasis.amount.toString()).toBe("1000");
  });

  // A reinvestment credits shares rather than buying them, and the fee on one
  // is tax withheld from the income that paid for them. The reporting book's
  // savings account has three such rows; counting their withholding as cost
  // would have added 255.51 DKK the holder never spent.
  it("ignores a fee on shares credited at a price of zero", () => {
    const [p] = computePositions([withFee(buy("AAPL", "5", "0", "2024-01-01"), "40")]);

    expect(p!.quantity.toString()).toBe("5");
    expect(p!.costBasis.amount.toString()).toBe("0");
  });
});
