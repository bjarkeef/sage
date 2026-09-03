import { describe, it, expect } from "vitest";
import { parseSnowballCSV, isSnowballCsv } from "./snowball-parser";

const header =
  "Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note";

function csv(...rows: string[]): string {
  return [header, ...rows].join("\n");
}

describe("parseSnowballCSV", () => {
  it("parses a BUY row", () => {
    const result = parseSnowballCSV(
      csv('BUY,2023-07-27 00:00:00,MSFT,"1450.00","2",DKK,"12.50",NASDAQ,"DKK","False",""'),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("buy");
    expect(tx.symbol).toBe("MSFT");
    expect(tx.quantity).toBe("2");
    expect(tx.price).toBe("1450.00");
    expect(tx.currency).toBe("DKK");
    expect(tx.tradeDate).toBe("2023-07-27");
    expect(tx.fee).toBe("12.50");
    expect(tx.feeCurrency).toBe("DKK");
    expect(tx.exchange).toBe("NASDAQ");
    expect(result.summary.buys).toBe(1);
  });

  it("parses a SELL row", () => {
    const result = parseSnowballCSV(
      csv('SELL,2024-08-05 00:00:00,AAPL,"203.8","2",USD,"13",NASDAQ,"USD","False",""'),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("sell");
    expect(tx.symbol).toBe("AAPL");
    expect(tx.quantity).toBe("2");
    expect(tx.price).toBe("203.8");
    expect(tx.currency).toBe("USD");
  });

  it("parses a DIVIDEND row (per-share format)", () => {
    const result = parseSnowballCSV(
      csv('DIVIDEND,2023-08-11 00:00:00,AAPL,"0.24","0.48",USD,"0.168",NASDAQ,"USD","False",""'),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("dividend");
    expect(tx.price).toBe("0.24");
    expect(tx.quantity).toBe("2"); // 0.48 / 0.24 = 2 shares
    expect(tx.currency).toBe("USD");
  });

  it("parses a DIVIDEND row (gross amount format, price=0)", () => {
    const result = parseSnowballCSV(
      csv('DIVIDEND,2023-11-17 00:00:00,AAPL,"0","3.3",DKK,"0.49",NASDAQ,"","False",""'),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("dividend");
    expect(tx.price).toBe("3.3");
    expect(tx.quantity).toBe("1"); // lump sum
    expect(tx.currency).toBe("DKK");
  });

  it("maps SPLIT with field swap (Price→quantity, price→0)", () => {
    const result = parseSnowballCSV(
      csv('SPLIT,2025-09-16 03:00:00,0THAM,"2.50000000","0",DKK,"0",LSE,"","",""'),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("split");
    expect(tx.symbol).toBe("0THAM.L");
    expect(tx.quantity).toBe("2.50000000"); // ratio from Price
    expect(tx.price).toBe("0");
  });

  it("parses CUSTOM_HOLDING buy/sell rows as custom instruments", () => {
    const result = parseSnowballCSV(
      csv(
        'BUY,2026-03-06 00:00:00,CASH_DKK,"1","10000",DKK,"0",CUSTOM_HOLDING,"DKK","False",""',
        'SELL,2026-01-17 00:00:00,CASHPOT_GBP,"1","640",GBP,"0",CUSTOM_HOLDING,"GBP","False",""',
      ),
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]!.symbol).toBe("CASH_DKK"); // no exchange suffix
    const inst = result.instruments.find((i) => i.symbol === "CASH_DKK");
    expect(inst!.assetType).toBe("custom");
    expect(inst!.exchange).toBe("CUSTOM");
    expect(result.skipped).toHaveLength(0);
  });

  it("maps custom STOCK_AS_DIVIDEND to a zero-price buy carrying the tax as fee", () => {
    const result = parseSnowballCSV(
      csv(
        'STOCK_AS_DIVIDEND,2026-04-30 00:00:00,CASH_DKK,"1","86.75505479",DKK,"46.7142602739726",CUSTOM_HOLDING,"","False",""',
      ),
    );
    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe("buy");
    expect(tx.price).toBe("0");
    expect(tx.quantity).toBe("86.75505479");
    expect(tx.fee).toBe("46.7142602739726");
    expect(tx.feeCurrency).toBe("DKK");
  });

  it("still skips non-custom STOCK_AS_DIVIDEND", () => {
    const result = parseSnowballCSV(
      csv('STOCK_AS_DIVIDEND,2025-12-01 00:00:00,AAPL,"1","0.5",USD,"0",NASDAQ,"","False",""'),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("collects CUSTOM_HOLDING_PRICE rows as price marks", () => {
    const result = parseSnowballCSV(
      csv(
        'CUSTOM_HOLDING_PRICE,2023-03-02 00:00:00,BROKER-ONE-BALANCED-DKK,"104.50000000","0",DKK,"0",CUSTOM_HOLDING,"","",""',
      ),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.priceMarks).toEqual([
      {
        symbol: "BROKER-ONE-BALANCED-DKK",
        date: "2023-03-02",
        price: "104.50000000",
        currency: "DKK",
      },
    ]);
  });

  it("decodes CUSTOM_HOLDING_SETTINGS JSON (quotes escaped as @*@)", () => {
    // Shape copied verbatim from a real 2026-07-18 export — the `@*@` quote
    // escaping and the unicode escapes are exactly what Snowball emits, and
    // that is the whole point of the fixture. Only the free-text note was
    // swapped for a neutral one.
    const note =
      "{@*@Holding@*@:{@*@Note@*@:@*@Cash held at the bank@*@,@*@Currency@*@:@*@DKK@*@,@*@Description@*@:@*@Cash account@*@,@*@DividendTax@*@:35,@*@Sector@*@:@*@Cash@*@},@*@Settings@*@:{@*@CustomHoldingType@*@:2,@*@IncomeType@*@:2,@*@FirstIncomeDate@*@:@*@2026-04-30T00:00:00@*@,@*@GenerateIncome@*@:true,@*@IncomeAmount@*@:4.25000000,@*@IncomeReinvestmentType@*@:2,@*@IsIncomeReinvested@*@:true,@*@MaturityDate@*@:@*@2041-05-01T00:00:00@*@,@*@Period@*@:1,@*@PeriodType@*@:4,@*@NextIncomeDate@*@:@*@2026-07-30T00:00:00@*@}}";
    const result = parseSnowballCSV(
      csv(
        `CUSTOM_HOLDING_SETTINGS,2026-07-18 00:00:00,CASH_DKK,"0","0",DKK,"0",CUSTOM_HOLDING,"","","${note}"`,
      ),
    );
    expect(result.customSettings).toEqual([
      {
        symbol: "CASH_DKK",
        name: "Cash account",
        note: "Cash held at the bank",
        sector: "Cash",
        currency: "DKK",
        holdingType: "savings",
        incomeEnabled: true,
        incomeYearlyPct: "4.25",
        frequencyUnit: "quarter",
        frequencyInterval: 1,
        firstPaymentDate: "2026-04-30",
        lastPaymentDate: "2041-05-01",
        reinvest: true,
        autoAdd: true,
      },
    ]);
  });

  it("skips settings with unknown PeriodType but keeps a warning", () => {
    const note =
      "{@*@Holding@*@:{@*@Note@*@:null,@*@Currency@*@:@*@DKK@*@,@*@Description@*@:@*@X@*@,@*@DividendTax@*@:null,@*@Sector@*@:null},@*@Settings@*@:{@*@CustomHoldingType@*@:0,@*@IncomeType@*@:1,@*@FirstIncomeDate@*@:@*@2026-01-01T00:00:00@*@,@*@GenerateIncome@*@:true,@*@IncomeAmount@*@:1.0,@*@IncomeReinvestmentType@*@:0,@*@IsIncomeReinvested@*@:false,@*@MaturityDate@*@:null,@*@Period@*@:1,@*@PeriodType@*@:9,@*@NextIncomeDate@*@:null}}";
    const result = parseSnowballCSV(
      csv(
        `CUSTOM_HOLDING_SETTINGS,2026-07-18 00:00:00,X_HOLDING,"0","0",DKK,"0",CUSTOM_HOLDING,"","","${note}"`,
      ),
    );
    expect(result.customSettings).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("X_HOLDING"))).toBe(true);
  });

  it("treats zero fee as null", () => {
    const result = parseSnowballCSV(
      csv('BUY,2025-01-08 00:00:00,KRONIX,"210.5","4",DKK,"0",CO,"DKK","False",""'),
    );
    const tx = result.transactions[0]!;
    expect(tx.symbol).toBe("KRONIX.CO");
    expect(tx.fee).toBeNull();
    expect(tx.feeCurrency).toBeNull();
  });

  it("falls back feeCurrency to transaction currency when empty", () => {
    const result = parseSnowballCSV(
      csv('DIVIDEND,2024-03-26 00:00:00,KOBANK,"7.5","75",DKK,"18.40",CO,"","False",""'),
    );
    const tx = result.transactions[0]!;
    expect(tx.symbol).toBe("KOBANK.CO");
    expect(tx.fee).toBe("18.40");
    expect(tx.feeCurrency).toBe("DKK");
  });

  it("extracts unique instruments from transactions", () => {
    const result = parseSnowballCSV(
      csv(
        'BUY,2023-07-27 00:00:00,MSFT,"1450.00","2",DKK,"12.50",NASDAQ,"DKK","False",""',
        'BUY,2023-08-03 00:00:00,MSFT,"920.00","2",DKK,"9.75",NASDAQ,"DKK","False",""',
        'BUY,2023-08-03 00:00:00,AAPL,"920.00","2",DKK,"9.75",NASDAQ,"DKK","False",""',
      ),
    );
    expect(result.instruments).toHaveLength(2);
    expect(result.instruments.map((i) => i.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("computes correct summary counts", () => {
    const result = parseSnowballCSV(
      csv(
        'BUY,2023-07-27 00:00:00,MSFT,"1450.00","2",DKK,"12.50",NASDAQ,"DKK","False",""',
        'SELL,2024-08-05 00:00:00,MSFT,"610.00","2",USD,"13",NASDAQ,"USD","False",""',
        'DIVIDEND,2023-08-11 00:00:00,AAPL,"0.24","0.48",USD,"0.168",NASDAQ,"USD","False",""',
        'SPLIT,2025-09-16 03:00:00,0THAM,"1.799","0",DKK,"0",LSE,"","",""',
        'BUY,2025-11-24 00:00:00,CASHPOT_GBP,"1","5.75",GBP,"0",CUSTOM_HOLDING,"GBP","False",""',
      ),
    );
    expect(result.summary.buys).toBe(2);
    expect(result.summary.sells).toBe(1);
    expect(result.summary.dividends).toBe(1);
    expect(result.summary.splits).toBe(1);
    expect(result.summary.skipped).toBe(0);
    expect(result.summary.newInstruments).toBe(4); // MSFT, AAPL, 0THAM.L, CASHPOT_GBP
  });

  it("appends exchange suffix for non-US exchanges", () => {
    const result = parseSnowballCSV(
      csv(
        'BUY,2025-01-01 00:00:00,FRANKA,"23","10",EUR,"0",XETRA,"EUR","False",""',
        'BUY,2025-01-01 00:00:00,SVEAFAST,"150","5",SEK,"0",ST,"SEK","False",""',
        'BUY,2025-01-01 00:00:00,THAMES,"13","3",GBP,"0",LSE,"GBP","False",""',
        'BUY,2025-01-01 00:00:00,SEINE,"45","2",EUR,"0",PA,"EUR","False",""',
        'BUY,2025-01-01 00:00:00,DUOMO,"21","5",EUR,"0",MI,"EUR","False",""',
        'BUY,2025-01-01 00:00:00,TULIP,"25","3",EUR,"0",AS,"EUR","False",""',
        'BUY,2025-01-01 00:00:00,NECKAR,"32","2",EUR,"0",STU,"EUR","False",""',
        'BUY,2025-01-01 00:00:00,MSFT,"300","1",USD,"0",NASDAQ,"USD","False",""',
        'BUY,2025-01-01 00:00:00,HUDSON,"35","2",USD,"0",NYSE,"USD","False",""',
      ),
    );
    const symbols = result.transactions.map((t) => t.symbol);
    expect(symbols).toEqual([
      "FRANKA.DE", // XETRA
      "SVEAFAST.ST", // Stockholm
      "THAMES.L", // London
      "SEINE.PA", // Paris
      "DUOMO.MI", // Milan
      "TULIP.AS", // Amsterdam
      "NECKAR.SG", // Stuttgart
      "MSFT", // NASDAQ (no suffix)
      "HUDSON", // NYSE (no suffix)
    ]);
    expect(result.instruments.map((i) => i.symbol).sort()).toEqual(
      [
        "NECKAR.SG",
        "SVEAFAST.ST",
        "HUDSON",
        "DUOMO.MI",
        "TULIP.AS",
        "FRANKA.DE",
        "THAMES.L",
        "MSFT",
        "SEINE.PA",
      ].sort(),
    );
  });

  it("uses original symbol as instrument name (without suffix)", () => {
    const result = parseSnowballCSV(
      csv('BUY,2025-01-01 00:00:00,FRANKA,"23","10",EUR,"0",XETRA,"EUR","False",""'),
    );
    const inst = result.instruments[0]!;
    expect(inst.symbol).toBe("FRANKA.DE");
    expect(inst.name).toBe("FRANKA");
  });

  it("skips unknown event types with reason", () => {
    const result = parseSnowballCSV(
      csv('TRANSFER,2023-01-01 00:00:00,MSFT,"100","1",USD,"0",NASDAQ,"","",""'),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("Unknown event");
  });
});

describe("isSnowballCsv", () => {
  it("recognizes a Snowball export by its header", () => {
    expect(isSnowballCsv(csv())).toBe(true);
  });

  it("recognizes it regardless of case and separator style", () => {
    expect(
      isSnowballCsv(
        "event,date,symbol,price,quantity,currency,fee_tax,exchange,do-not-adjust-cash",
      ),
    ).toBe(true);
  });

  // The whole point: an ordinary broker export must still reach the generic
  // importer, or auto-routing would break every other file.
  it("does not claim an ordinary broker export", () => {
    expect(
      isSnowballCsv("Date,Ticker,Side,Qty,Price,CCY,Fee\n2024-01-15,AAPL,BUY,10,150,USD,1"),
    ).toBe(false);
  });

  // Event + Symbol alone are common enough elsewhere; the cash flag is the
  // fingerprint, so a file with only the generic-looking half is not Snowball.
  it("does not claim a file that merely has an Event column", () => {
    expect(isSnowballCsv("Event,Date,Symbol,Price,Quantity,Currency")).toBe(false);
  });

  it("handles an empty file", () => {
    expect(isSnowballCsv("")).toBe(false);
  });
});
