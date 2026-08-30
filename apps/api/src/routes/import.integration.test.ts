import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import {
  transaction,
  importRow,
  instrument,
  portfolio,
  autoDividend,
  customHolding,
  manualPrice,
  customIncome,
  user,
} from "../db/schema";
import { syncCustomIncome } from "../services/custom-income-sync";

const header =
  "Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note";

function csvFile(...rows: string[]): File {
  const text = [header, ...rows].join("\n");
  return new File([text], "portfolio.csv", { type: "text/csv" });
}

function formBody(file: File): FormData {
  const fd = new FormData();
  fd.append("file", file);
  return fd;
}

function formBodyWithRestore(file: File, restoreDeleted: boolean): FormData {
  const fd = new FormData();
  fd.append("file", file);
  if (restoreDeleted) fd.append("restoreDeleted", "true");
  return fd;
}

describeDb("import routes", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    cookie = await signUpTestUser(app, "import@example.com");
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("returns 400 when no file is uploaded", async () => {
    const res = await app.request("/import/snowball/preview", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(400);
  });

  it("preview returns parsed transactions and skipped rows", async () => {
    const file = csvFile(
      'BUY,2023-07-27 00:00:00,MSFT,"100","5",USD,"10",NASDAQ,"USD","False",""',
      'TRANSFER,2025-11-24 00:00:00,CASHPOT_GBP,"1","5.75",GBP,"0",NYSE,"GBP","False",""',
    );
    const res = await app.request("/import/snowball/preview", {
      method: "POST",
      headers: { cookie },
      body: formBody(file),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      transactions: { symbol: string }[];
      skipped: unknown[];
      summary: { buys: number };
      instruments: unknown[];
    };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]!.symbol).toBe("MSFT");
    expect(body.skipped.length).toBeGreaterThanOrEqual(1);
    expect(body.summary.buys).toBe(1);
    expect(body.instruments).toHaveLength(1);
  });

  it("commit inserts transactions and creates instruments", async () => {
    const file = csvFile(
      'BUY,2023-07-27 00:00:00,GOOG,"100","3",USD,"5",NASDAQ,"USD","False",""',
      'DIVIDEND,2023-09-01 00:00:00,GOOG,"0.50","1.50",USD,"0.5",NASDAQ,"USD","False",""',
    );
    const res = await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(file),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inserted: number;
      instrumentsCreated: number;
      skippedDuplicates: number;
    };
    expect(body.inserted).toBe(2);
    expect(body.instrumentsCreated).toBe(1);
    expect(body.skippedDuplicates).toBe(0);
  });

  it("skips duplicate transactions on second import", async () => {
    const file = csvFile('BUY,2023-07-27 00:00:00,GOOG,"100","3",USD,"5",NASDAQ,"USD","False",""');
    const res = await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(file),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: number; skippedDuplicates: number };
    expect(body.inserted).toBe(0);
    expect(body.skippedDuplicates).toBe(1);
  });

  it("stores fee and feeCurrency from import", async () => {
    const file = csvFile(
      'BUY,2024-01-01 00:00:00,NVDA,"500","2",USD,"13.50",NASDAQ,"USD","False",""',
    );
    await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(file),
    });

    const listRes = await app.request("/transactions", { headers: { cookie } });
    const page = (await listRes.json()) as {
      items: {
        instrumentSymbol: string;
        fee: string | null;
        feeCurrency: string | null;
      }[];
    };
    const nvda = page.items.find((r) => r.instrumentSymbol === "NVDA");
    expect(nvda).toBeDefined();
    expect(nvda!.fee).toBe("13.50");
    expect(nvda!.feeCurrency).toBe("USD");
  });

  describe("idempotent re-import", () => {
    async function commit(file: File, restoreDeleted = false) {
      const res = await app.request("/import/snowball/commit", {
        method: "POST",
        headers: { cookie },
        body: formBodyWithRestore(file, restoreDeleted),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        inserted: number;
        restored: number;
        claimedExisting: number;
        skippedDuplicates: number;
        instrumentsCreated: number;
      };
    }

    async function preview(file: File) {
      const res = await app.request("/import/snowball/preview", {
        method: "POST",
        headers: { cookie },
        body: formBody(file),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        transactions: unknown[];
        deleted: { symbol: string }[];
        skipped: { symbol: string; reason: string }[];
        summary: { deleted: number; skipped: number };
      };
    }

    it("re-importing the same file inserts nothing", async () => {
      const file = csvFile(
        'BUY,2024-02-01 00:00:00,AMD,"150","4",USD,"1",NASDAQ,"USD","False",""',
        'SELL,2024-03-01 00:00:00,AMD,"170","2",USD,"1",NASDAQ,"USD","False",""',
      );
      const first = await commit(file);
      expect(first.inserted).toBe(2);

      const second = await commit(file);
      expect(second.inserted).toBe(0);
      expect(second.skippedDuplicates).toBe(2);
    });

    it("an extended export only inserts the new rows", async () => {
      const original = csvFile(
        'BUY,2024-02-01 00:00:00,INTC,"40","10",USD,"1",NASDAQ,"USD","False",""',
      );
      await commit(original);

      const extended = csvFile(
        'BUY,2024-02-01 00:00:00,INTC,"40","10",USD,"1",NASDAQ,"USD","False",""',
        'BUY,2024-05-01 00:00:00,INTC,"35","5",USD,"1",NASDAQ,"USD","False",""',
      );
      const result = await commit(extended);
      expect(result.inserted).toBe(1);
      expect(result.skippedDuplicates).toBe(1);
    });

    it("claims a manually-entered transaction with different decimal formatting", async () => {
      // Manual entry: quantity "8.00", price "95.0" (formatting Sage's form might produce).
      const users = await tdb.db.select().from(transaction).limit(1);
      const portfolioId = users[0]!.portfolioId;
      await tdb.db.insert(instrument).values({
        symbol: "KO",
        name: "Coca-Cola",
        exchange: "NYSE",
        currency: "USD",
        assetType: "stock",
      });
      await tdb.db.insert(transaction).values({
        portfolioId,
        instrumentSymbol: "KO",
        type: "buy",
        quantity: "8.00",
        price: "95.0",
        currency: "USD",
        tradeDate: "2024-06-01",
      });

      const file = csvFile('BUY,2024-06-01 00:00:00,KO,"95","8",USD,"0",NYSE,"USD","False",""');
      const p = await preview(file);
      expect(p.transactions).toHaveLength(0);
      expect(
        p.skipped.some((s) => s.symbol === "KO" && s.reason === "Matches existing transaction"),
      ).toBe(true);

      const result = await commit(file);
      expect(result.claimedExisting).toBe(1);
      expect(result.inserted).toBe(0);

      const rows = await tdb.db
        .select()
        .from(transaction)
        .where(eq(transaction.instrumentSymbol, "KO"));
      expect(rows).toHaveLength(1);
    });

    it("does not resurrect an edited transaction", async () => {
      const file = csvFile(
        'BUY,2024-07-01 00:00:00,FIZZCO,"180","3",USD,"1",NASDAQ,"USD","False",""',
      );
      await commit(file);

      await tdb.db
        .update(transaction)
        .set({ price: "185" })
        .where(eq(transaction.instrumentSymbol, "FIZZCO"));

      const result = await commit(file);
      expect(result.inserted).toBe(0);
      expect(result.skippedDuplicates).toBe(1);
      const rows = await tdb.db
        .select()
        .from(transaction)
        .where(eq(transaction.instrumentSymbol, "FIZZCO"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.price).toBe("185");
    });

    it("deleted transactions stay deleted unless restoreDeleted is set", async () => {
      const file = csvFile('BUY,2024-08-01 00:00:00,ORCL,"120","6",USD,"1",NYSE,"USD","False",""');
      await commit(file);
      await tdb.db.delete(transaction).where(eq(transaction.instrumentSymbol, "ORCL"));

      const p = await preview(file);
      expect(p.deleted.map((d) => d.symbol)).toEqual(["ORCL"]);
      expect(p.summary.deleted).toBe(1);

      const withoutFlag = await commit(file);
      expect(withoutFlag.restored).toBe(0);
      expect(withoutFlag.skippedDuplicates).toBe(1);
      expect(
        await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "ORCL")),
      ).toHaveLength(0);

      const withFlag = await commit(file, true);
      expect(withFlag.restored).toBe(1);
      const rows = await tdb.db
        .select({ id: transaction.id })
        .from(transaction)
        .where(eq(transaction.instrumentSymbol, "ORCL"));
      expect(rows).toHaveLength(1);
      const ledger = await tdb.db
        .select()
        .from(importRow)
        .where(eq(importRow.transactionId, rows[0]!.id));
      expect(ledger).toHaveLength(1);
    });

    it("two identical rows in one file are two transactions, deduped as a pair on re-import", async () => {
      const row = 'BUY,2024-09-01 00:00:00,CSCO,"50","10",USD,"1",NASDAQ,"USD","False",""';
      const file = csvFile(row, row);
      const first = await commit(file);
      expect(first.inserted).toBe(2);

      const second = await commit(file);
      expect(second.inserted).toBe(0);
      expect(second.skippedDuplicates).toBe(2);
    });

    it("pre-ledger transactions are claimed, not duplicated (self-backfill)", async () => {
      // Simulate a pre-feature import: transactions exist, ledger is empty.
      const users = await tdb.db.select().from(transaction).limit(1);
      const portfolioId = users[0]!.portfolioId;
      await tdb.db.insert(instrument).values({
        symbol: "IBM",
        name: "IBM",
        exchange: "NYSE",
        currency: "USD",
        assetType: "stock",
      });
      await tdb.db.insert(transaction).values([
        {
          portfolioId,
          instrumentSymbol: "IBM",
          type: "buy",
          quantity: "5",
          price: "140",
          currency: "USD",
          tradeDate: "2024-10-01",
        },
        {
          portfolioId,
          instrumentSymbol: "IBM",
          type: "dividend",
          quantity: "5",
          price: "1.67",
          currency: "USD",
          tradeDate: "2024-11-01",
        },
      ]);

      const file = csvFile(
        'BUY,2024-10-01 00:00:00,IBM,"140","5",USD,"0",NYSE,"USD","False",""',
        'DIVIDEND,2024-11-01 00:00:00,IBM,"1.67","8.35",USD,"0",NYSE,"USD","False",""',
      );
      const result = await commit(file);
      expect(result.claimedExisting).toBe(2);
      expect(result.inserted).toBe(0);
      expect(
        await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "IBM")),
      ).toHaveLength(2);
    });

    it("double commit of the same file (double-click) inserts once", async () => {
      const file = csvFile('BUY,2024-12-01 00:00:00,TXN,"200","2",USD,"1",NASDAQ,"USD","False",""');
      const [a, b] = [await commit(file), await commit(file)];
      expect(a.inserted + b.inserted).toBe(1);
      expect(
        await tdb.db.select().from(transaction).where(eq(transaction.instrumentSymbol, "TXN")),
      ).toHaveLength(1);
    });
  });

  it("adopts a matching auto-added dividend in place, and re-import is idempotent", async () => {
    const [pf] = await tdb.db.select().from(portfolio);
    const portfolioId = pf!.id;
    await tdb.db.insert(instrument).values({
      symbol: "PFE",
      name: "Pfizer",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "PFE",
      type: "buy",
      quantity: "20",
      price: "150",
      currency: "USD",
      tradeDate: "2024-01-02",
    });
    // As reconciliation would leave it: auto transaction + live ledger row.
    const [autoTx] = await tdb.db
      .insert(transaction)
      .values({
        portfolioId,
        instrumentSymbol: "PFE",
        type: "dividend",
        quantity: "20",
        price: "1.355",
        currency: "USD",
        tradeDate: "2024-03-29",
        source: "auto",
      })
      .returning({ id: transaction.id });
    await tdb.db.insert(autoDividend).values({
      portfolioId,
      symbol: "PFE",
      exDate: "2024-03-01",
      transactionId: autoTx!.id,
    });

    const pfeDivs = async () =>
      (
        await tdb.db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId))
      ).filter((t) => t.instrumentSymbol === "PFE" && t.type === "dividend");

    // Broker reports the same payment 2 days later, net of withholding.
    const row = 'DIVIDEND,2024-03-31 00:00:00,PFE,"1.15","20",USD,"0",NASDAQ,"USD","False",""';
    const res = await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(csvFile(row)),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adoptedAuto: number; inserted: number };
    expect(body.adoptedAuto).toBe(1);

    const divs = await pfeDivs();
    expect(divs).toHaveLength(1); // no duplicate
    expect(divs[0]!.id).toBe(autoTx!.id); // same row, adopted in place
    expect(divs[0]!.price).toBe("1.15"); // broker values won
    expect(divs[0]!.tradeDate).toBe("2024-03-31");
    expect(divs[0]!.source).toBeNull();

    const links = await tdb.db
      .select()
      .from(importRow)
      .where(eq(importRow.transactionId, autoTx!.id));
    expect(links).toHaveLength(1); // import ledger owns it now

    // Re-import the same file: row-hash ledger says already-imported.
    const again = await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(csvFile(row)),
    });
    const againBody = (await again.json()) as { adoptedAuto: number; skippedDuplicates: number };
    expect(againBody.adoptedAuto).toBe(0);
    expect(againBody.skippedDuplicates).toBeGreaterThanOrEqual(1);
    expect(await pfeDivs()).toHaveLength(1);

    // The auto_dividend FK survived adoption → reconciliation still sees
    // this ex-date as covered and will never re-plan it.
    const ledgerRows = await tdb.db
      .select()
      .from(autoDividend)
      .where(eq(autoDividend.portfolioId, portfolioId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.transactionId).toBe(autoTx!.id);
  });

  it("adopts (not claim-existing) an auto row that is content-identical to the import row", async () => {
    // Regression for Finding 1: a byte-identical CSV row must never resolve
    // via claim-existing against an auto transaction — claim-existing never
    // clears `source`, which would leave an import-backed row mislabeled
    // 'auto' forever and still adoptable a second time by a future import.
    const [pf] = await tdb.db.select().from(portfolio);
    const portfolioId = pf!.id;
    await tdb.db.insert(instrument).values({
      symbol: "MEDIQO",
      name: "Johnson & Johnson",
      exchange: "XNYS",
      currency: "USD",
      assetType: "stock",
    });
    await tdb.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "MEDIQO",
      type: "buy",
      quantity: "10",
      price: "160",
      currency: "USD",
      tradeDate: "2024-05-02",
    });
    const [autoTx] = await tdb.db
      .insert(transaction)
      .values({
        portfolioId,
        instrumentSymbol: "MEDIQO",
        type: "dividend",
        quantity: "10",
        price: "1.19",
        currency: "USD",
        tradeDate: "2024-06-06",
        source: "auto",
      })
      .returning({ id: transaction.id });
    await tdb.db.insert(autoDividend).values({
      portfolioId,
      symbol: "MEDIQO",
      exDate: "2024-05-20",
      transactionId: autoTx!.id,
    });

    // Content-identical to the auto row: same date, price, quantity, currency.
    const row = 'DIVIDEND,2024-06-06 00:00:00,MEDIQO,"1.19","10",USD,"0",NYSE,"USD","False",""';
    const res = await app.request("/import/snowball/commit", {
      method: "POST",
      headers: { cookie },
      body: formBody(csvFile(row)),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      adoptedAuto: number;
      claimedExisting: number;
      inserted: number;
    };
    expect(body.adoptedAuto).toBe(1);
    expect(body.claimedExisting).toBe(0);
    expect(body.inserted).toBe(0);

    const jnjDivs = (
      await tdb.db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId))
    ).filter((t) => t.instrumentSymbol === "MEDIQO" && t.type === "dividend");
    expect(jnjDivs).toHaveLength(1);
    expect(jnjDivs[0]!.id).toBe(autoTx!.id);
    expect(jnjDivs[0]!.source).toBeNull();

    const links = await tdb.db
      .select()
      .from(importRow)
      .where(eq(importRow.transactionId, autoTx!.id));
    expect(links).toHaveLength(1);
  });

  it("imports a custom holding end-to-end: trades, marks, settings, then income sync claims the credit", async () => {
    // The commit handler's post-import trigger calls syncCustomIncome with an
    // UNPINNED `now = new Date()`, while this test pins its own direct calls
    // to 2026-07-18. They only agree because that happens to be "today" —
    // on/after the fixture's next quarterly due date (2026-07-30) the
    // unpinned background trigger would materialize a second payment and
    // permanently break the length assertions below. Freeze only the Date
    // class (not timers — testcontainers/pg drivers need real setTimeout) so
    // the unpinned trigger resolves the same frozen date as the pinned calls.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-18T12:00:00Z") });
    try {
      const file = csvFile(
        'BUY,2026-03-06 00:00:00,CASH_DKK,"1","10000",DKK,"0",CUSTOM_HOLDING,"DKK","False",""',
        'CUSTOM_HOLDING_PRICE,2026-03-06 00:00:00,CASH_DKK,"1","0",DKK,"0",CUSTOM_HOLDING,"","",""',
        'BUY,2026-04-01 00:00:00,CASH_DKK,"1","20000",DKK,"0",CUSTOM_HOLDING,"DKK","False",""',
        'STOCK_AS_DIVIDEND,2026-04-30 00:00:00,CASH_DKK,"1","86.75505479",DKK,"46.7142602739726",CUSTOM_HOLDING,"","False",""',
        'CUSTOM_HOLDING_SETTINGS,2026-07-18 00:00:00,CASH_DKK,"0","0",DKK,"0",CUSTOM_HOLDING,"","","{@*@Holding@*@:{@*@Note@*@:null,@*@Currency@*@:@*@DKK@*@,@*@Description@*@:@*@Cash account@*@,@*@DividendTax@*@:35,@*@Sector@*@:@*@Cash@*@},@*@Settings@*@:{@*@CustomHoldingType@*@:2,@*@IncomeType@*@:2,@*@FirstIncomeDate@*@:@*@2026-04-30T00:00:00@*@,@*@GenerateIncome@*@:true,@*@IncomeAmount@*@:4.25000000,@*@IncomeReinvestmentType@*@:2,@*@IsIncomeReinvested@*@:true,@*@MaturityDate@*@:@*@2041-05-01T00:00:00@*@,@*@Period@*@:1,@*@PeriodType@*@:4,@*@NextIncomeDate@*@:@*@2026-07-30T00:00:00@*@}}"',
      );

      const commitRes = await app.request("/import/snowball/commit", {
        method: "POST",
        headers: { cookie },
        body: formBody(file),
      });
      expect(commitRes.status).toBe(200);
      const body = (await commitRes.json()) as {
        inserted: number;
        customHoldings: number;
        priceMarks: number;
      };
      expect(body.inserted).toBe(3); // 2 buys + 1 credit
      expect(body.customHoldings).toBe(1);
      expect(body.priceMarks).toBe(1);

      // settings row landed
      const [holding] = await tdb.db
        .select()
        .from(customHolding)
        .where(eq(customHolding.symbol, "CASH_DKK"));
      expect(holding!.incomeEnabled).toBe(true);
      expect(holding!.frequencyUnit).toBe("quarter");
      expect(holding!.reinvest).toBe(true);

      // mark landed
      const marks = await tdb.db
        .select()
        .from(manualPrice)
        .where(eq(manualPrice.symbol, "CASH_DKK"));
      expect(marks).toHaveLength(1);

      // instrument name updated from settings Description
      const [inst] = await tdb.db
        .select()
        .from(instrument)
        .where(eq(instrument.symbol, "CASH_DKK"));
      expect(inst!.name).toBe("Cash account");
      expect(inst!.assetType).toBe("custom");

      // The route's post-commit trigger is fire-and-forget and shares the
      // module-level in-flight lock (custom-income-sync.ts) with this direct
      // call — whichever runs first wins the lock and the other becomes a
      // no-op, so a single direct call can race a still-running background
      // one. Poll with a pinned "now" until the ledger lands (either run
      // produces the same single row for this fixture) instead of asserting
      // against a single, possibly-too-early attempt.
      const [u] = await tdb.db.select().from(user).limit(1);
      const now = new Date("2026-07-18T12:00:00Z");
      let ledger: (typeof customIncome.$inferSelect)[] = [];
      for (let attempt = 0; attempt < 40; attempt++) {
        await syncCustomIncome(tdb.db, u!.id, now);
        ledger = await tdb.db.select().from(customIncome);
        if (ledger.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      // engine claimed the imported credit — no duplicate
      expect(ledger).toHaveLength(1);
      const txs = await tdb.db
        .select()
        .from(transaction)
        .where(eq(transaction.instrumentSymbol, "CASH_DKK"));
      expect(txs).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
