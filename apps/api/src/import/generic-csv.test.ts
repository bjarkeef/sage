import { describe, it, expect } from "vitest";
import { inspectCsv, parseGenericCsv, type ColumnMapping } from "./generic-csv";

const SAMPLE = `Date,Ticker,Side,Qty,Price,CCY,Fee
2024-01-15,AAPL,BUY,10,150.00,USD,1.00
15/02/2024,MSFT,Sell,5,400,USD,
2024-03-01,KO,dividend,100,0.46,USD,
bad,row,X,0,0,USD,
`;

const MAPPING: ColumnMapping = {
  tradeDate: "Date",
  symbol: "Ticker",
  type: "Side",
  quantity: "Qty",
  price: "Price",
  currency: "CCY",
  fee: "Fee",
  dateFormat: "auto",
};

describe("inspectCsv", () => {
  it("returns headers, samples, and suggested mapping", () => {
    const r = inspectCsv(SAMPLE);
    expect(r.headers).toEqual(["Date", "Ticker", "Side", "Qty", "Price", "CCY", "Fee"]);
    expect(r.rowCount).toBe(4);
    expect(r.sampleRows[0]!.Ticker).toBe("AAPL");
    expect(r.suggestedMapping.symbol).toBe("Ticker");
    expect(r.suggestedMapping.tradeDate).toBe("Date");
    expect(r.suggestedMapping.type).toBe("Side");
  });
});

describe("parseGenericCsv", () => {
  it("maps rows into import transactions and skips bad ones", () => {
    const r = parseGenericCsv(SAMPLE, MAPPING);
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]).toMatchObject({
      symbol: "AAPL",
      type: "buy",
      quantity: "10",
      price: "150",
      currency: "USD",
      tradeDate: "2024-01-15",
      fee: "1",
    });
    expect(r.transactions[1]).toMatchObject({
      symbol: "MSFT",
      type: "sell",
      tradeDate: "2024-02-15",
    });
    expect(r.transactions[2]).toMatchObject({
      symbol: "KO",
      type: "dividend",
    });
    expect(r.skipped.length).toBeGreaterThanOrEqual(1);
    expect(r.instruments.map((i) => i.symbol).sort()).toEqual(["AAPL", "KO", "MSFT"]);
  });

  it("uses defaultCurrency when the currency cell is empty", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
2024-06-01,VOO,buy,2,500,
`;
    const r = parseGenericCsv(csv, {
      tradeDate: "Date",
      symbol: "Symbol",
      type: "Type",
      quantity: "Quantity",
      price: "Price",
      currency: "Currency",
      defaultCurrency: "EUR",
    });
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.currency).toBe("EUR");
  });

  it("rejects mapping that points at missing columns", () => {
    const r = parseGenericCsv(SAMPLE, { ...MAPPING, symbol: "Nope" });
    expect(r.transactions).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/symbol/);
  });

  const MINIMAL_MAPPING: ColumnMapping = {
    tradeDate: "Date",
    symbol: "Symbol",
    type: "Type",
    quantity: "Quantity",
    price: "Price",
    currency: "Currency",
  };

  it("accepts a price of 0 — bonus shares, gifted stock, scrip dividends, and reinvested custom income all buy at price 0", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
2024-06-01,VOO,buy,2,0,USD
`;
    const r = parseGenericCsv(csv, MINIMAL_MAPPING);
    expect(r.skipped).toHaveLength(0);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ symbol: "VOO", type: "buy", price: "0" });
  });

  it("still rejects a negative price", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
2024-06-01,VOO,buy,2,-5,USD
`;
    const r = parseGenericCsv(csv, MINIMAL_MAPPING);
    expect(r.transactions).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toMatch(/negative/i);
  });
});
