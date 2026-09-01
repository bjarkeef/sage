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

describe("parseGenericCsv — real broker export shapes", () => {
  const BASE: ColumnMapping = {
    tradeDate: "Date",
    symbol: "Symbol",
    type: "Type",
    quantity: "Quantity",
    price: "Price",
    currency: "Currency",
  };

  it("imports a US-broker export with currency symbols and grouped numbers", () => {
    // This exact shape imported zero rows, every skip blaming a negative price.
    const csv = `Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Currency
02/11/2025,Buy,AAPL,APPLE INC,"1,200",$241.30,$1.00,USD
04/22/2025,Cash Dividend,KO,COCA COLA,45,$0.485,,USD
`;
    const r = parseGenericCsv(csv, {
      tradeDate: "Date",
      symbol: "Symbol",
      type: "Action",
      quantity: "Quantity",
      price: "Price",
      currency: "Currency",
      fee: "Fees & Comm",
      name: "Description",
      dateFormat: "mdy",
    });
    expect(r.skipped).toHaveLength(0);
    expect(r.transactions[0]).toMatchObject({
      symbol: "AAPL",
      type: "buy",
      quantity: "1200",
      price: "241.3",
      fee: "1",
      tradeDate: "2025-02-11",
    });
    expect(r.transactions[1]).toMatchObject({ symbol: "KO", type: "dividend", price: "0.485" });
  });

  it("imports when the file has no currency column at all", () => {
    // Single-currency brokers omit it, and defaultCurrency existed for exactly
    // this case while the validator still demanded the column.
    const csv = `Date,Symbol,Type,Quantity,Price
2025-02-11,AAPL,buy,10,241.30
`;
    const r = parseGenericCsv(csv, { ...BASE, currency: null, defaultCurrency: "GBP" });
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.currency).toBe("GBP");
    expect(r.warnings.join(" ")).toMatch(/every row is treated as GBP/);
  });

  it("refuses a file with neither a currency column nor a default", () => {
    const csv = `Date,Symbol,Type,Quantity,Price
2025-02-11,AAPL,buy,10,241.30
`;
    const r = parseGenericCsv(csv, { ...BASE, currency: null });
    expect(r.transactions).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/default currency/i);
  });

  it("drops a redundant sign on the quantity and says so", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency,Fee
2025-04-22,KO,SELL,-45,71.20,USD,-1.00
`;
    const r = parseGenericCsv(csv, { ...BASE, fee: "Fee" });
    expect(r.skipped).toHaveLength(0);
    expect(r.transactions[0]).toMatchObject({ type: "sell", quantity: "45", fee: "1" });
    expect(r.warnings.join(" ")).toMatch(/negative quantit/i);
  });

  it("warns when a date could be read two ways", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
01/02/2025,AAPL,buy,1,241.30,USD
15/02/2025,AAPL,buy,1,241.30,USD
`;
    const r = parseGenericCsv(csv, BASE);
    expect(r.transactions[0]!.tradeDate).toBe("2025-02-01");
    // Only the genuinely ambiguous row counts; 15/02 can only be day/month.
    expect(r.warnings.join(" ")).toMatch(/1 date is ambiguous/);
  });

  it("applies user type overrides to values the table cannot place", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
2025-07-01,KO,Reinvest Shares,0.3,72.10,USD
`;
    const skippedRun = parseGenericCsv(csv, BASE);
    expect(skippedRun.skipped[0]!.reason).toMatch(/Unrecognised type/);

    const mapped = parseGenericCsv(csv, {
      ...BASE,
      typeAliases: { "reinvest shares": "buy" },
    });
    expect(mapped.skipped).toHaveLength(0);
    expect(mapped.transactions[0]).toMatchObject({ type: "buy", quantity: "0.3" });
  });

  it("names the real problem when a number cannot be read", () => {
    const csv = `Date,Symbol,Type,Quantity,Price,Currency
2025-02-11,AAPL,buy,10,n/a,USD
`;
    const r = parseGenericCsv(csv, BASE);
    expect(r.skipped[0]!.reason).toMatch(/Unreadable price/);
    expect(r.skipped[0]!.reason).not.toMatch(/negative/);
  });
});

describe("inspectCsv — value summaries", () => {
  it("reports distinct values per column with what each resolves to", () => {
    const csv = `Date,Symbol,Action,Quantity,Price,Currency
2025-02-11,AAPL,Buy,10,241.30,USD
2025-04-22,KO,Cash Dividend,45,0.485,USD
2025-07-01,KO,Reinvest Shares,0.3,72.10,USD
`;
    const r = inspectCsv(csv);
    const actions = r.valuesByColumn["Action"]!;
    expect(actions.map((v) => [v.value, v.resolved])).toEqual(
      expect.arrayContaining([
        ["Buy", "buy"],
        ["Cash Dividend", "dividend"],
        ["Reinvest Shares", null],
      ]),
    );
  });

  it("omits free-text columns that are not categories", () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `2025-02-${String((i % 28) + 1).padStart(2, "0")},AAPL,buy,${i + 1},1.00,USD`,
    ).join("\n");
    const r = inspectCsv(`Date,Symbol,Type,Quantity,Price,Currency\n${rows}\n`);
    expect(r.valuesByColumn["Quantity"]).toBeUndefined();
    expect(r.valuesByColumn["Type"]).toBeDefined();
  });
});
