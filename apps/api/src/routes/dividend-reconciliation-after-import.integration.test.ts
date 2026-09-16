import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { autoDividend, portfolio } from "../db/schema";

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Found on a fresh install. The first page a new user opens runs the lazy
 * dividend reconciliation against an EMPTY book and claims its 24-hour slot.
 * The import that follows fetches dividend history, but nothing reconciles it,
 * so the book shows none of the dividends it received for a day — and the
 * overview compared a full forward year against that near-empty trailing one
 * and printed it as growth.
 */
describeDb("dividend reconciliation after an import", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  const provider = new FakeMarketDataProvider({
    dividends: {
      PAYCO: [
        {
          symbol: "PAYCO",
          amountPerShare: Money.of("0.50", "USD"),
          exDividendDate: new Date(`${daysAgo(120)}T00:00:00Z`),
          paymentDate: new Date(`${daysAgo(105)}T00:00:00Z`),
          announcedDate: null,
          recordDate: null,
          period: "Quarterly",
        },
      ],
    },
  });

  beforeAll(async () => {
    tdb = await withTestDb();
    app = createApp(tdb.db, provider, createAuth(tdb.db, testEnv));
    cookie = await signUpTestUser(app, "recon-after-import@example.com");
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("reconciles the imported book's past dividends without waiting a day", async () => {
    // The empty-book visit that used to spend the 24h slot.
    await app.request("/dividends/income", { headers: { cookie } });

    const fd = new FormData();
    fd.append(
      "file",
      new File(
        [`Date,Ticker,Side,Qty,Price,CCY\n${daysAgo(300)},PAYCO,BUY,10,40.00,USD\n`],
        "b.csv",
        {
          type: "text/csv",
        },
      ),
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
    const res = await app.request("/import/csv/commit", {
      method: "POST",
      headers: { cookie },
      body: fd,
    });
    expect(res.status).toBe(200);

    const [pf] = await tdb.db.select({ id: portfolio.id }).from(portfolio).limit(1);
    await vi.waitFor(
      async () => {
        await app.request("/dividends/income", { headers: { cookie } });
        const rows = await tdb.db
          .select()
          .from(autoDividend)
          .where(eq(autoDividend.portfolioId, pf!.id));
        expect(rows).toHaveLength(1);
      },
      { timeout: 5_000, interval: 100 },
    );
  });

  it("does the same for a holding added by hand", async () => {
    const handCookie = await signUpTestUser(app, "recon-after-buy@example.com");
    await app.request("/dividends/income", { headers: { cookie: handCookie } });

    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: handCookie },
      body: JSON.stringify({
        instrument: {
          symbol: "PAYCO",
          name: "Pay Co",
          exchange: "NMS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "4",
        price: "40",
        tradeDate: daysAgo(300),
      }),
    });
    expect(res.status).toBe(201);

    const portfolios = await tdb.db.select({ id: portfolio.id }).from(portfolio);
    await vi.waitFor(
      async () => {
        await app.request("/dividends/income", { headers: { cookie: handCookie } });
        const rows = await tdb.db.select().from(autoDividend);
        const theirs = rows.filter((r) => r.portfolioId !== portfolios[0]!.id);
        expect(theirs).toHaveLength(1);
      },
      { timeout: 5_000, interval: 100 },
    );
  });
});
