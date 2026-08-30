import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { Money } from "../money/money";
import type { PositionTransaction } from "../portfolio/positions";
import type { DividendHistoryRow } from "../portfolio/dividends";
import { planAutoDividends, excludeMatchedInFlight } from "./auto-dividends";

const TODAY = "2026-07-16";

function buy(
  symbol: string,
  quantity: string,
  tradeDate: string,
  ccy = "USD",
): PositionTransaction {
  return {
    symbol,
    type: "buy",
    quantity: new Decimal(quantity),
    price: Money.of("10", ccy),
    tradeDate: new Date(`${tradeDate}T00:00:00Z`),
  };
}

function sell(
  symbol: string,
  quantity: string,
  tradeDate: string,
  ccy = "USD",
): PositionTransaction {
  return { ...buy(symbol, quantity, tradeDate, ccy), type: "sell" };
}

function divTx(symbol: string, tradeDate: string, ccy = "USD"): PositionTransaction {
  return {
    symbol,
    type: "dividend",
    quantity: new Decimal("100"),
    price: Money.of("0.46", ccy),
    tradeDate: new Date(`${tradeDate}T00:00:00Z`),
  };
}

function div(
  symbol: string,
  exDate: string,
  paymentDate: string | null,
  amountPerShare = "0.46",
  currency = "USD",
): DividendHistoryRow {
  return { symbol, exDate, amountPerShare, currency, paymentDate };
}

describe("planAutoDividends", () => {
  it("plans a dividend for a held position whose payment date has passed", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01")],
      dividends: [div("KO", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toEqual([
      {
        symbol: "KO",
        exDate: "2026-03-01",
        tradeDate: "2026-03-15",
        quantity: "100",
        price: "0.46",
        currency: "USD",
      },
    ]);
  });

  it("excludes in-flight dividends (payment date still ahead)", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01")],
      dividends: [div("KO", "2026-07-10", "2026-08-01")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toEqual([]);
  });

  it("falls back to exDate as the cash date when paymentDate is null", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01")],
      dividends: [div("KO", "2026-03-01", null)],
      ledger: [],
      today: TODAY,
    });
    expect(plan[0]!.tradeDate).toBe("2026-03-01");
  });

  it("skips positions sold out before the ex-date, keeps those sold after", () => {
    const plan = planAutoDividends({
      transactions: [
        buy("KO", "100", "2026-01-01"),
        sell("KO", "100", "2026-02-15"), // gone before 2026-03-01 ex-date
        buy("O", "50", "2026-01-01"),
        sell("O", "50", "2026-03-10"), // still held on 2026-03-01 ex-date
      ],
      dividends: [div("KO", "2026-03-01", "2026-03-15"), div("O", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan.map((p) => p.symbol)).toEqual(["O"]);
    expect(plan[0]!.quantity).toBe("50");
  });

  it("applies splits to the held quantity", () => {
    const plan = planAutoDividends({
      transactions: [
        buy("NVDA", "10", "2026-01-01"),
        { ...buy("NVDA", "4", "2026-02-01"), type: "split" }, // 4:1 → 40 shares
      ],
      dividends: [div("NVDA", "2026-03-01", "2026-03-15", "0.01")],
      ledger: [],
      today: TODAY,
    });
    expect(plan[0]!.quantity).toBe("40");
  });

  it("skips ledger entries — including tombstones", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01")],
      dividends: [div("KO", "2026-03-01", "2026-03-15"), div("KO", "2026-06-01", "2026-06-15")],
      ledger: [{ symbol: "KO", exDate: "2026-03-01" }],
      today: TODAY,
    });
    expect(plan.map((p) => p.exDate)).toEqual(["2026-06-01"]);
  });

  it("skips dividends matched by an existing dividend transaction within ±10 days", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01"), divTx("KO", "2026-03-18")], // 3 days off pay date
      dividends: [div("KO", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toEqual([]);
  });

  it("does NOT match a dividend transaction 11+ days away", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01"), divTx("KO", "2026-03-26")], // 11 days off
      dividends: [div("KO", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toHaveLength(1);
  });

  it("matches one-to-one for monthly payers: one recorded payment cannot satisfy two dividends", () => {
    // O pays monthly; user recorded only the April payment. The recorded tx
    // (Apr 16) is within 10 days of ONLY the April dividend; but even if two
    // provider dividends fell inside one window, nearest-first one-to-one
    // pairing must leave the other unmatched.
    const plan = planAutoDividends({
      transactions: [buy("O", "50", "2026-01-01"), divTx("O", "2026-04-16")],
      dividends: [
        div("O", "2026-04-01", "2026-04-15", "0.27"),
        div("O", "2026-05-01", "2026-05-15", "0.27"),
      ],
      ledger: [],
      today: TODAY,
    });
    expect(plan.map((p) => p.exDate)).toEqual(["2026-05-01"]);
  });

  it("pairs nearest-first when one transaction sits between two dividends", () => {
    // Tx on Apr 20: 5 days from Apr 15 payment, 25 from May 15 → pairs with April.
    const plan = planAutoDividends({
      transactions: [buy("O", "50", "2026-01-01"), divTx("O", "2026-04-20")],
      dividends: [
        div("O", "2026-04-01", "2026-04-15", "0.27"),
        div("O", "2026-05-01", "2026-05-15", "0.27"),
      ],
      ledger: [],
      today: TODAY,
    });
    expect(plan.map((p) => p.exDate)).toEqual(["2026-05-01"]);
  });

  it("returns rows sorted by symbol then exDate (deterministic)", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2025-01-01"), buy("AAPL", "10", "2025-01-01")],
      dividends: [
        div("KO", "2026-06-01", "2026-06-15"),
        div("AAPL", "2026-02-01", "2026-02-15", "0.25"),
        div("KO", "2026-03-01", "2026-03-15"),
      ],
      ledger: [],
      today: TODAY,
    });
    expect(plan.map((p) => `${p.symbol}|${p.exDate}`)).toEqual([
      "AAPL|2026-02-01",
      "KO|2026-03-01",
      "KO|2026-06-01",
    ]);
  });

  it("ignores dividends for symbols never transacted", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01")],
      dividends: [div("MSFT", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toEqual([]);
  });

  it("resolves multi-way contention nearest-first", () => {
    // One recorded tx sits within ±10 days of BOTH dividends (2 days from the
    // first, 6 from the second). Nearest-first pairing must claim the closer
    // one, leaving only the farther dividend in the plan.
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01"), divTx("KO", "2026-04-12")],
      dividends: [div("KO", "2026-04-05", "2026-04-10"), div("KO", "2026-04-13", "2026-04-18")],
      ledger: [],
      today: TODAY,
    });
    expect(plan.map((p) => p.exDate)).toEqual(["2026-04-13"]);
  });

  it("matches at exactly the 10-day boundary", () => {
    const plan = planAutoDividends({
      transactions: [buy("KO", "100", "2026-01-01"), divTx("KO", "2026-03-25")], // exactly 10 days
      dividends: [div("KO", "2026-03-01", "2026-03-15")],
      ledger: [],
      today: TODAY,
    });
    expect(plan).toEqual([]);
  });
});

describe("excludeMatchedInFlight", () => {
  function inFlightRow(
    symbol: string,
    exDate: string,
    paymentDate: string | null = null,
  ): { symbol: string; exDate: string; paymentDate: string | null } {
    return { symbol, exDate, paymentDate };
  }

  it("excludes an in-flight row that pairs with a received row within 10 days", () => {
    // Ledger booked cash 3 days before the provider's expected payment date —
    // broker credited early. Must not ALSO count as forward income.
    const out = excludeMatchedInFlight(
      [inFlightRow("KO", "2026-06-01", "2026-07-20")],
      [{ symbol: "KO", cashDate: "2026-07-17" }],
    );
    expect(out).toEqual([]);
  });

  it("keeps an in-flight row with no received row for its symbol", () => {
    const out = excludeMatchedInFlight(
      [inFlightRow("KO", "2026-06-01", "2026-07-20")],
      [{ symbol: "MSFT", cashDate: "2026-07-17" }],
    );
    expect(out).toHaveLength(1);
  });

  it("keeps an in-flight row more than 10 days from any received row", () => {
    const out = excludeMatchedInFlight(
      [inFlightRow("KO", "2026-06-01", "2026-07-20")],
      [{ symbol: "KO", cashDate: "2026-07-05" }], // 15 days away
    );
    expect(out).toHaveLength(1);
  });

  it("falls back to exDate when paymentDate is null", () => {
    const out = excludeMatchedInFlight(
      [inFlightRow("KO", "2026-07-18", null)],
      [{ symbol: "KO", cashDate: "2026-07-20" }], // 2 days from exDate
    );
    expect(out).toEqual([]);
  });

  it("is one-to-one: one received row cannot clear two in-flight rows", () => {
    const out = excludeMatchedInFlight(
      [inFlightRow("O", "2026-04-01", "2026-04-15"), inFlightRow("O", "2026-05-01", "2026-05-15")],
      [{ symbol: "O", cashDate: "2026-04-16" }],
    );
    // Nearest pairing claims the April row; May survives.
    expect(out.map((r) => r.exDate)).toEqual(["2026-05-01"]);
  });

  it("scopes matching to the same symbol only", () => {
    const out = excludeMatchedInFlight(
      [inFlightRow("KO", "2026-06-01", "2026-07-20")],
      [
        { symbol: "KO", cashDate: "2026-08-15" },
        { symbol: "FIZZCO", cashDate: "2026-07-19" },
      ],
    );
    expect(out).toHaveLength(1); // KO's own received row is 26 days away — no match
  });
});
