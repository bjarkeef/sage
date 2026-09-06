import { it, expect, beforeAll, afterAll } from "vitest";
import { Decimal, type CurrencyCode } from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { instrument, transaction, portfolio, user, priceDaily } from "../db/schema";
import { findBasisMismatches } from "./basis-reconciliation";

/** `n` days before today as a "YYYY-MM-DD" UTC key. Relative by construction —
 *  a hardcoded window would start failing on its own once it aged out. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** EUR is 1.1 to the dollar here, so a EUR fill converts into USD by dividing
 *  by 1/1.1. `getRates(base, targets)` returns units of each target per 1 base;
 *  callers DIVIDE a native amount by it. */
const fakeFx: IFxRateService = {
  getRates(base: CurrencyCode, targets: CurrencyCode[]) {
    const out = new Map<CurrencyCode, Decimal>();
    for (const t of targets) {
      if (base === "USD" && t === "EUR") out.set(t, new Decimal("0.909090909"));
      else if (base === t) out.set(t, new Decimal(1));
    }
    return Promise.resolve(out);
  },
} as IFxRateService;

describeDb("findBasisMismatches", () => {
  let t: TestDb;
  const userId = "basis-user";
  let portfolioId: string;

  beforeAll(async () => {
    t = await withTestDb();
    await t.db.insert(user).values({
      id: userId,
      name: "U",
      email: "basis@example.com",
      emailVerified: true,
    });
    const [pf] = await t.db
      .insert(portfolio)
      .values({ userId, name: "Main" })
      .returning({ id: portfolio.id });
    portfolioId = pf!.id;

    const symbols = [
      { symbol: "SPLITCO", currency: "USD" },
      { symbol: "STEADY", currency: "USD" },
      { symbol: "PAYER", currency: "USD" },
      { symbol: "NOBARS", currency: "USD" },
      { symbol: "EURBUY", currency: "EUR" },
      { symbol: "EURSPLIT", currency: "EUR" },
    ];
    await t.db.insert(instrument).values(
      symbols.map((s) => ({
        symbol: s.symbol,
        name: s.symbol,
        exchange: "TEST",
        currency: s.currency,
        assetType: "stock",
      })),
    );

    const bar = (symbol: string, date: string, close: string, currency = "USD") => ({
      symbol,
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: "0",
      currency,
    });

    await t.db.insert(priceDaily).values([
      // Stored history back-adjusted to a post-reverse-split basis: every bar
      // reads ~10x what was actually paid at the time.
      bar("SPLITCO", daysAgo(30), "50"),
      bar("SPLITCO", daysAgo(20), "50"),
      // Fills track closes within ordinary intraday movement.
      bar("STEADY", daysAgo(30), "100"),
      bar("STEADY", daysAgo(20), "102"),
      // A dividend's per-share income against a share price is a 200x
      // divergence by arithmetic; it must never be sampled.
      bar("PAYER", daysAgo(30), "50"),
      // EURBUY: a EUR fill against a USD close that agrees once converted.
      bar("EURBUY", daysAgo(30), "110"),
      // EURSPLIT: a EUR fill against a USD close that disagrees even converted.
      bar("EURSPLIT", daysAgo(30), "1100"),
    ]);

    const tx = (
      symbol: string,
      type: string,
      date: string,
      price: string,
      currency = "USD",
      quantity = "10",
    ) => ({
      portfolioId,
      instrumentSymbol: symbol,
      type,
      quantity,
      price,
      currency,
      tradeDate: date,
    });

    await t.db.insert(transaction).values([
      tx("SPLITCO", "buy", daysAgo(30), "5"),
      tx("SPLITCO", "sell", daysAgo(20), "5"),
      tx("STEADY", "buy", daysAgo(30), "100"),
      tx("STEADY", "sell", daysAgo(20), "101"),
      tx("PAYER", "dividend", daysAgo(30), "0.25"),
      // No price_daily row for this trade date at all.
      tx("NOBARS", "buy", daysAgo(15), "42"),
      tx("EURBUY", "buy", daysAgo(30), "100", "EUR"),
      tx("EURSPLIT", "buy", daysAgo(30), "100", "EUR"),
    ]);
  }, 90_000);

  afterAll(async () => {
    await t?.stop();
  });

  it("flags a symbol whose stored closes are an order of magnitude off", async () => {
    const { findings } = await findBasisMismatches({ db: t.db }, userId);
    const split = findings.find((f) => f.symbol === "SPLITCO");
    expect(split).toBeDefined();
    expect(Number(split!.factor)).toBeCloseTo(10, 1);
    expect(split!.mismatched).toBe(2);
    expect(split!.samples).toBe(2);
  });

  it("leaves a symbol alone when its fills track its closes", async () => {
    const { findings } = await findBasisMismatches({ db: t.db }, userId);
    expect(findings.find((f) => f.symbol === "STEADY")).toBeUndefined();
  });

  it("does not sample dividends or splits", async () => {
    const { findings } = await findBasisMismatches({ db: t.db }, userId);
    expect(findings.find((f) => f.symbol === "PAYER")).toBeUndefined();
  });

  it("treats a transaction with no stored bar as unchecked, not as clean", async () => {
    const { findings } = await findBasisMismatches({ db: t.db }, userId);
    expect(findings.find((f) => f.symbol === "NOBARS")).toBeUndefined();
  });

  it("converts across currencies before comparing", async () => {
    const { findings } = await findBasisMismatches({ db: t.db, fxRateService: fakeFx }, userId);
    // 100 EUR is 110 USD, which is the close: agreement, not a mismatch.
    expect(findings.find((f) => f.symbol === "EURBUY")).toBeUndefined();
    // 100 EUR is 110 USD against a 1100 close: a genuine 10x disagreement.
    expect(findings.find((f) => f.symbol === "EURSPLIT")).toBeDefined();
  });

  it("skips a cross-currency sample when no rate is available, rather than inventing one", async () => {
    // Without an FX service the EUR rows cannot be compared at all. Skipping
    // them keeps a currency gap from masquerading as a basis mismatch.
    const { findings } = await findBasisMismatches({ db: t.db }, userId);
    expect(findings.find((f) => f.symbol === "EURBUY")).toBeUndefined();
    expect(findings.find((f) => f.symbol === "EURSPLIT")).toBeUndefined();
  });

  it("counts every checked sample, including symbols with nothing wrong", async () => {
    const { checkedBySymbol } = await findBasisMismatches({ db: t.db }, userId);
    // STEADY has two priced transactions and no mismatch: checked, and clean.
    expect(checkedBySymbol.get("STEADY")).toBe(2);
    // NOBARS has a transaction but no bar on its trade date: never checked.
    expect(checkedBySymbol.has("NOBARS")).toBe(false);
  });

  it("does not count a cross-currency sample it could not convert", async () => {
    // Unchecked is not clean — the distinction `unverified` rests on.
    const { checkedBySymbol } = await findBasisMismatches({ db: t.db }, userId);
    expect(checkedBySymbol.has("EURBUY")).toBe(false);
  });

  it("scopes the join when asked for specific symbols", async () => {
    const { findings, checkedBySymbol } = await findBasisMismatches({ db: t.db }, userId, {
      symbols: ["SPLITCO"],
    });
    expect(findings.map((f) => f.symbol)).toEqual(["SPLITCO"]);
    expect(checkedBySymbol.has("STEADY")).toBe(false);
  });

  it("returns empty for an empty symbol filter rather than scanning the book", async () => {
    const { findings, checkedBySymbol } = await findBasisMismatches({ db: t.db }, userId, {
      symbols: [],
    });
    expect(findings).toEqual([]);
    expect(checkedBySymbol.size).toBe(0);
  });

  it("flags a symbol as an FX gap when its bars exist but no rate could convert its trades", async () => {
    // Without an FX service every cross-currency row is dropped, so both EUR
    // symbols joined a bar (they are in `rows`) and checked zero samples —
    // the FX-gap shape, not the missing-bars shape.
    const { fxGapSymbols } = await findBasisMismatches({ db: t.db }, userId);
    expect(fxGapSymbols).toContain("EURBUY");
    expect(fxGapSymbols).toContain("EURSPLIT");
  });

  it("does not call a symbol an FX gap when it simply has no bars at all", async () => {
    // NOBARS never joins a price_daily row in the first place, so its zero
    // checked-count is the ordinary "no history" case, not an FX gap.
    const { fxGapSymbols } = await findBasisMismatches({ db: t.db }, userId);
    expect(fxGapSymbols).not.toContain("NOBARS");
  });

  it("does not call a clean symbol an FX gap", async () => {
    // STEADY checked its samples successfully; it has no gap of any kind.
    const { fxGapSymbols } = await findBasisMismatches({ db: t.db }, userId);
    expect(fxGapSymbols).not.toContain("STEADY");
  });
});
