import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { describeDb, withTestDb, type TestDb } from "../testing";
import {
  instrument,
  transaction,
  portfolio,
  user,
  customHolding,
  customIncome,
  dividendHistory,
} from "../db/schema";
import { syncCustomIncome } from "./custom-income-sync";

const NOW = new Date("2026-07-18T12:00:00Z");

describeDb("syncCustomIncome", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u1";

  // Testcontainers can exceed vitest's default 10s hook under parallel load.
  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U",
      email: "u@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    await t.db.insert(instrument).values({
      symbol: "CASH_DKK",
      name: "Cash account",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "CASH_DKK",
      portfolioId,
      holdingType: "savings",
      sector: "Cash",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: "2041-05-01",
      autoAdd: true,
      reinvest: true,
    });
    // Invented top-ups at price 1.00, shaped to exercise the accrual window:
    // a mid-period increase, a month boundary, and a top-up ON the payment
    // date (which must NOT accrue but MUST count towards shares held).
    const buys: [string, string][] = [
      ["2026-03-02", "8000"],
      ["2026-03-16", "4000"],
      ["2026-04-01", "8000"],
      ["2026-04-30", "5000"],
    ];
    await t.db.insert(transaction).values(
      buys.map(([tradeDate, quantity]) => ({
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity,
        price: "1",
        currency: "DKK",
        tradeDate,
      })),
    );
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("materializes the due payment: ledger + reinvest buy + dividend_history, Snowball-exact", async () => {
    await syncCustomIncome(t.db, userId, NOW);

    const ledger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.portfolioId, portfolioId));
    expect(ledger).toHaveLength(1); // 2026-04-30 due; 2026-07-30 is in the future
    expect(ledger[0]!.payDate).toBe("2026-04-30");
    expect(ledger[0]!.transactionId).not.toBeNull();

    const [credit] = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, ledger[0]!.transactionId!));
    expect(credit!.type).toBe("buy");
    expect(credit!.price).toBe("0");
    expect(credit!.source).toBe("custom-income");
    // Derived by hand from accrueGrossIncome's contract, not read back off the
    // implementation — otherwise this asserts only that the code agrees with
    // itself. Daily balances over [2026-03-02, 2026-04-30), the payment date
    // excluded:
    //     14 days ×  8,000 =  112,000
    //     16 days × 12,000 =  192,000
    //     29 days × 20,000 =  580,000
    //                        ─────────
    //                         884,000 unit-days
    // gross = 884,000 × 4.25 / 36,500 = 102.93150684931507
    //   tax = gross × 0.35             =  36.02602739726027
    //   net = gross × 0.65             =  66.90547945205479
    expect(Number(credit!.quantity)).toBeCloseTo(66.90547945, 6);
    expect(Number(credit!.fee)).toBeCloseTo(36.02602739, 6); // withheld tax

    const divs = await t.db
      .select()
      .from(dividendHistory)
      .where(eq(dividendHistory.symbol, "CASH_DKK"));
    expect(divs).toHaveLength(1);
    expect(divs[0]!.exDate).toBe("2026-04-30");
    expect(divs[0]!.source).toBe("custom");
    // amountPerShare × shares held ON the ex-date (incl. same-day top-up and
    // credit, matching core's sharesHeldOn convention) must equal the gross.
    const shares = 25000 + 66.90547945;
    expect(Number(divs[0]!.amountPerShare) * shares).toBeCloseTo(102.93150685, 6);
  });

  it("is idempotent — a second run adds nothing", async () => {
    await syncCustomIncome(t.db, userId, NOW);
    const ledger = await t.db.select().from(customIncome);
    const txs = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "CASH_DKK"));
    expect(ledger).toHaveLength(1);
    expect(txs).toHaveLength(5); // 4 buys + 1 credit
  });

  it("tombstone: deleting the credit and re-running does not resurrect it", async () => {
    const [row] = await t.db.select().from(customIncome);
    await t.db.delete(transaction).where(eq(transaction.id, row!.transactionId!));
    await syncCustomIncome(t.db, userId, NOW);
    const ledger = await t.db.select().from(customIncome);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.transactionId).toBeNull(); // FK went null, row persisted
    const txs = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "CASH_DKK"));
    expect(txs).toHaveLength(4); // credit NOT recreated
  });

  it("materializes the next quarter once time passes it", async () => {
    await syncCustomIncome(t.db, userId, new Date("2026-07-30T12:00:00Z"));
    const ledger = await t.db.select().from(customIncome);
    expect(ledger.map((r) => r.payDate).sort()).toEqual(["2026-04-30", "2026-07-30"]);
  });
});

describeDb("syncCustomIncome — per-holding fault isolation", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u3";

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U3",
      email: "u3@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    // BROKEN: frequencyInterval 0 makes incomePaymentDates throw. Seeded
    // FIRST so it iterates before GOOD — the point is that it must not
    // poison the rest of the run.
    await t.db.insert(instrument).values({
      symbol: "BROKEN",
      name: "Broken",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "BROKEN",
      portfolioId,
      holdingType: "savings",
      sector: "Cash",
      incomeEnabled: true,
      incomeYearlyPct: "1",
      frequencyUnit: "month",
      frequencyInterval: 0,
      firstPaymentDate: "2026-01-01",
      autoAdd: true,
      reinvest: true,
    });

    // GOOD: configured exactly like the existing CASH_DKK holding.
    await t.db.insert(instrument).values({
      symbol: "GOOD",
      name: "Good",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "GOOD",
      portfolioId,
      holdingType: "savings",
      sector: "Cash",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: "2041-05-01",
      autoAdd: true,
      reinvest: true,
    });
    await t.db.insert(transaction).values({
      portfolioId,
      instrumentSymbol: "GOOD",
      type: "buy",
      quantity: "10000",
      price: "1",
      currency: "DKK",
      tradeDate: "2026-03-06",
    });
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("isolates a broken holding's failure so other holdings still materialize", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncCustomIncome(t.db, userId, new Date("2026-07-18T12:00:00Z"));

    // Assert on the call log BEFORE mockRestore() — mockRestore() also
    // clears mock.calls (like mockReset()), so it must come last.
    expect(warn).toHaveBeenCalled();
    const warnedBroken = warn.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("BROKEN")),
    );
    expect(warnedBroken).toBe(true);
    warn.mockRestore();

    const goodLedger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.symbol, "GOOD"));
    expect(goodLedger).toHaveLength(1);
    expect(goodLedger[0]!.payDate).toBe("2026-04-30");
    expect(goodLedger[0]!.transactionId).not.toBeNull();

    const brokenLedger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.symbol, "BROKEN"));
    expect(brokenLedger).toHaveLength(0);
  });
});

describeDb("syncCustomIncome — imported-history backfill", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u2";

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U2",
      email: "u2@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    await t.db.insert(instrument).values({
      symbol: "CASH_DKK",
      name: "Cash account",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "CASH_DKK",
      portfolioId,
      holdingType: "savings",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: "2041-05-01",
      autoAdd: true,
      reinvest: true,
    });
    // Imported history: buys AND the imported STOCK_AS_DIVIDEND credit
    // (price-0 buy with the tax in fee) — exactly what Task 7's parser emits.
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "6000",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-03-02",
      },
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        quantity: "14000",
        price: "1",
        currency: "DKK",
        tradeDate: "2026-04-01",
      },
      {
        portfolioId,
        instrumentSymbol: "CASH_DKK",
        type: "buy",
        // Round numbers on purpose: this case reconstructs gross from what the
        // broker reported (credited + withheld), so the arithmetic should be
        // checkable at a glance — 65 net + 35 tax is a gross of 100 at 35%.
        quantity: "65",
        price: "0",
        currency: "DKK",
        tradeDate: "2026-04-30",
        fee: "35",
        feeCurrency: "DKK",
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("claims the imported credit instead of creating a second one", async () => {
    await syncCustomIncome(t.db, userId, new Date("2026-07-18T12:00:00Z"));

    const txs = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "CASH_DKK"));
    expect(txs).toHaveLength(3); // NOTHING new inserted

    const ledger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.portfolioId, portfolioId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.payDate).toBe("2026-04-30");
    const claimedTx = txs.find((x) => x.id === ledger[0]!.transactionId);
    expect(claimedTx!.price).toBe("0"); // it claimed the imported credit

    // dividend_history reconstructed from broker values:
    // gross = credited(65 × price 1.00) + fee(35) = 100
    const divs = await t.db
      .select()
      .from(dividendHistory)
      .where(eq(dividendHistory.symbol, "CASH_DKK"));
    expect(divs).toHaveLength(1);
    const shares = 20065; // held on ex-date incl. credit
    expect(Number(divs[0]!.amountPerShare) * shares).toBeCloseTo(100, 5);
  });
});

describeDb("syncCustomIncome — dust balance from rounded import", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u4";

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U4",
      email: "u4@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    await t.db.insert(instrument).values({
      symbol: "GBP_DUST",
      name: "GBP dust",
      exchange: "CUSTOM",
      currency: "GBP",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "GBP_DUST",
      portfolioId,
      holdingType: "savings",
      incomeEnabled: true,
      incomeYearlyPct: "3.37",
      frequencyUnit: "week",
      frequencyInterval: 1,
      firstPaymentDate: "2026-05-18",
      autoAdd: true,
      reinvest: true,
    });
    // Fully sold out, but Snowball's CSV export rounds STOCK_AS_DIVIDEND
    // share quantities to 8dp — re-importing leaves a ~1e-8 dust residual.
    await t.db.insert(transaction).values([
      {
        portfolioId,
        instrumentSymbol: "GBP_DUST",
        type: "buy",
        quantity: "100",
        price: "1",
        currency: "GBP",
        tradeDate: "2026-03-01",
      },
      {
        portfolioId,
        instrumentSymbol: "GBP_DUST",
        type: "sell",
        quantity: "99.99999999",
        price: "1",
        currency: "GBP",
        tradeDate: "2026-05-11",
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("pays the legitimate backdated payment, then skips every subsequent dust tick forever", async () => {
    // Phase 1: firstPaymentDate (2026-05-18) is the FIRST scheduled payment,
    // so its accrual window backfills all the way to the first transaction
    // (2026-03-01) — genuinely real interest on the 100 GBP position held
    // for ~71 days before the sell (gross ≈ 0.656 GBP, well above the
    // sub-cent threshold). This one payment is correct and must NOT be
    // suppressed by the dust fix — mirrors Snowball's own STOCK_AS_DIVIDEND
    // history for the period before the sell-out.
    await syncCustomIncome(t.db, userId, new Date("2026-05-18T12:00:00Z"));
    const afterFirst = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.symbol, "GBP_DUST"));
    expect(afterFirst).toHaveLength(1);
    const txsAfterFirst = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "GBP_DUST"));
    expect(txsAfterFirst.filter((tx) => tx.source === "custom-income")).toHaveLength(1);

    // Phase 2: 8 more weekly ticks become due between 2026-05-25 and
    // 2026-07-13 — entirely inside the post-sell ~1e-8 dust-balance period
    // (start of each window = the previous due date, so none of these
    // reach back to the real pre-sell balance). Before the fix, each of
    // these minted a microscopic reinvest transaction forever; after the
    // fix, all 8 must be skipped — no new ledger rows, no new transactions.
    await syncCustomIncome(t.db, userId, new Date("2026-07-18T12:00:00Z"));

    const ledger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.symbol, "GBP_DUST"));
    expect(ledger).toHaveLength(1); // unchanged — no new dust rows

    const dustTxs = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.instrumentSymbol, "GBP_DUST"));
    expect(dustTxs.filter((tx) => tx.source === "custom-income")).toHaveLength(1); // still just the one legit payment
  });
});

describeDb("syncCustomIncome — non-reinvest income is gross, not net (CRITICAL 3)", () => {
  let t: TestDb;
  let portfolioId: string;
  const userId = "u5";

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U5",
      email: "u5@x.dk",
      emailVerified: true,
      dividendTaxRate: "35",
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;
    await t.db.insert(instrument).values({
      symbol: "DKK_CASH_PAYOUT",
      name: "DKK cash payout",
      exchange: "CUSTOM",
      currency: "DKK",
      assetType: "custom",
    });
    await t.db.insert(customHolding).values({
      symbol: "DKK_CASH_PAYOUT",
      portfolioId,
      holdingType: "savings",
      sector: "Cash",
      incomeEnabled: true,
      incomeYearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: "2041-05-01",
      autoAdd: true,
      reinvest: false, // cash payout, not credited as shares
    });
    // Same invented ladder as the reinvesting case above, so the two can be
    // compared directly: the gross is identical, only its disposal differs.
    const buys: [string, string][] = [
      ["2026-03-02", "8000"],
      ["2026-03-16", "4000"],
      ["2026-04-01", "8000"],
      ["2026-04-30", "5000"],
    ];
    await t.db.insert(transaction).values(
      buys.map(([tradeDate, quantity]) => ({
        portfolioId,
        instrumentSymbol: "DKK_CASH_PAYOUT",
        type: "buy",
        quantity,
        price: "1",
        currency: "DKK",
        tradeDate,
      })),
    );
  }, 60_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("writes the ledger dividend row as GROSS (tax withheld separately via fee)", async () => {
    await syncCustomIncome(t.db, userId, NOW);

    const ledger = await t.db
      .select()
      .from(customIncome)
      .where(eq(customIncome.portfolioId, portfolioId));
    expect(ledger).toHaveLength(1);

    const [credit] = await t.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, ledger[0]!.transactionId!));
    expect(credit!.type).toBe("dividend");
    expect(credit!.quantity).toBe("1");
    // gross ≈ 102.9315… (884,000 unit-days × 4.25% / 365) — NOT the ~66.91
    // net-of-35%-tax figure a pre-fix reader would expect here.
    expect(Number(credit!.price)).toBeCloseTo(102.93150685, 5);
    expect(Number(credit!.fee)).toBeCloseTo(36.02602739, 6); // withheld tax, unchanged

    // quantity(1) x price must equal gross: buildReceivedDividends computes
    // income this way directly, and the client applies the user's tax rate
    // on top of it — net here would mean the payment is taxed twice.
    const income = Number(credit!.quantity) * Number(credit!.price);
    expect(income).toBeCloseTo(102.93150685, 5);
  });
});
