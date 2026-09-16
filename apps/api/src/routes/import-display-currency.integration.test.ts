import { it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Decimal } from "@sage/core";
import type { IFxRateService } from "@sage/provider-interface";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { user } from "../db/schema";

/** 1 EUR = 1.25 USD. Rates are target/source, so source → target DIVIDES. */
const fx: IFxRateService = {
  getRate: (base, target) =>
    Promise.resolve(new Decimal(base === "EUR" && target === "USD" ? "1.25" : "0.8")),
  getRates: (base, targets) =>
    Promise.resolve(
      new Map(targets.map((t) => [t, new Decimal(base === "EUR" && t === "USD" ? "1.25" : "0.8")])),
    ),
};

function genericCsv(rows: string[]): FormData {
  const fd = new FormData();
  fd.append(
    "file",
    new File([["Date,Ticker,Side,Qty,Price,CCY", ...rows].join("\n")], "b.csv", {
      type: "text/csv",
    }),
  );
  fd.append(
    "mapping",
    JSON.stringify({
      tradeDate: "Date",
      symbol: "Ticker",
      type: "Side",
      quantity: "Qty",
      price: "Price",
      currency: "CCY",
      dateFormat: "auto",
    }),
  );
  return fd;
}

async function displayCurrencyOf(tdb: TestDb, email: string): Promise<string | null> {
  const [row] = await tdb.db
    .select({ displayCurrency: user.displayCurrency })
    .from(user)
    .where(eq(user.email, email));
  return row?.displayCurrency ?? null;
}

/**
 * Found on a fresh install. A mixed-currency book with no display currency
 * disagreed with itself: the overview quietly used USD, Dividends showed a dash
 * for every total, Book value was a dash, and Goal asked the user to go to
 * Settings. The first import now picks the currency most of the book is in,
 * and says so.
 */
describeDb("an import sets a display currency when there is none", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();
    app = createApp(
      tdb.db,
      new FakeMarketDataProvider(),
      createAuth(tdb.db, testEnv),
      undefined,
      fx,
    );
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("picks the currency with the largest cost basis, converted", async () => {
    const cookie = await signUpTestUser(app, "mixed@example.com");
    // USD 1,200 (= EUR 960) across two holdings against EUR 1,000 in one:
    // more USD rows, more USD in nominal terms, but the book is mostly EUR.
    const res = await app.request("/import/csv/commit", {
      method: "POST",
      headers: { cookie },
      body: genericCsv([
        "2025-01-02,USONE,BUY,6,100,USD",
        "2025-01-02,USTWO,BUY,6,100,USD",
        "2025-01-02,EUONE,BUY,10,100,EUR",
      ]),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { displayCurrencySet: string | null }).displayCurrencySet).toBe(
      "EUR",
    );
    expect(await displayCurrencyOf(tdb, "mixed@example.com")).toBe("EUR");
  });

  it("never overrides a currency the user already chose", async () => {
    const cookie = await signUpTestUser(app, "chosen@example.com");
    await tdb.db
      .update(user)
      .set({ displayCurrency: "GBP" })
      .where(eq(user.email, "chosen@example.com"));

    const res = await app.request("/import/csv/commit", {
      method: "POST",
      headers: { cookie },
      body: genericCsv(["2025-01-02,EUONE,BUY,10,100,EUR"]),
    });
    expect(((await res.json()) as { displayCurrencySet: string | null }).displayCurrencySet).toBe(
      null,
    );
    expect(await displayCurrencyOf(tdb, "chosen@example.com")).toBe("GBP");
  });
});
