import { it, expect, beforeAll, afterAll } from "vitest";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { Quote } from "@sage/provider-interface";
import { describeDb, withTestDb, testEnv, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { dividendHistory, portfolio, transaction } from "../db/schema";

function quote(symbol: string, price: string, ccy = "USD"): Quote {
  return { symbol, price: Money.of(price, ccy), asOf: new Date(), previousClose: null };
}

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Recon User", email, password: "test-password-at-least-8-chars" }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status}`);
  return res.headers.get("set-cookie")!;
}

describeDb("reconciliation via read routes", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  // Read the DB directly — the /transactions GET only exposes `source` after
  // Task 7, and this task must not depend on it.
  async function listTransactions() {
    return tdb.db.select().from(transaction);
  }

  async function forceNextRun() {
    await tdb.db.update(portfolio).set({ lastReconciledAt: null });
  }

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({ quotes: { KO: quote("KO", "60") } });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUp(app, "recon-routes@example.com");

    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: {
          symbol: "KO",
          name: "Coca-Cola",
          exchange: "XNYS",
          currency: "USD",
          assetType: "stock",
        },
        type: "buy",
        quantity: "100",
        price: "50",
        tradeDate: "2025-01-01",
      }),
    });
    await tdb.db.insert(dividendHistory).values([
      {
        symbol: "KO",
        exDate: "2025-06-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-06-15",
        paymentDateEstimated: false,
        source: "test",
      },
      {
        symbol: "KO",
        exDate: "2025-09-01",
        amountPerShare: "0.46",
        currency: "USD",
        paymentDate: "2025-09-15",
        paymentDateEstimated: false,
        source: "test",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("GET /portfolio backfills auto dividends on first read", async () => {
    const res = await app.request("/portfolio", { headers: { cookie } });
    expect(res.status).toBe(200);
    const autos = (await listTransactions()).filter((t) => t.source === "auto");
    expect(autos).toHaveLength(2);
    expect(autos.every((t) => t.type === "dividend" && t.instrumentSymbol === "KO")).toBe(true);
  });

  it("a second read within 24h is a no-op", async () => {
    const res = await app.request("/portfolio", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await listTransactions()).filter((t) => t.source === "auto")).toHaveLength(2);
  });

  it("deleting an auto dividend via the API tombstones it for future runs", async () => {
    const [victim] = (await listTransactions()).filter((t) => t.source === "auto");
    const del = await app.request(`/transactions/${victim!.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(204);

    await forceNextRun();
    const res = await app.request("/performance?range=ALL", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await listTransactions()).filter((t) => t.source === "auto")).toHaveLength(1);
  });

  it("the other read routes trigger reconciliation too", async () => {
    // Add a fresh missing dividend, then touch /dividends and /goal.
    await tdb.db.insert(dividendHistory).values({
      symbol: "KO",
      exDate: "2025-12-01",
      amountPerShare: "0.46",
      currency: "USD",
      paymentDate: "2025-12-15",
      paymentDateEstimated: false,
      source: "test",
    });
    await forceNextRun();
    const divRes = await app.request("/dividends/income", { headers: { cookie } });
    expect(divRes.status).toBe(200);
    expect((await listTransactions()).filter((t) => t.source === "auto")).toHaveLength(2);

    await tdb.db.insert(dividendHistory).values({
      symbol: "KO",
      exDate: "2026-03-01",
      amountPerShare: "0.46",
      currency: "USD",
      paymentDate: "2026-03-15",
      paymentDateEstimated: false,
      source: "test",
    });
    await forceNextRun();
    const goalRes = await app.request("/goal", { headers: { cookie } });
    expect(goalRes.status).toBe(200);
    expect((await listTransactions()).filter((t) => t.source === "auto")).toHaveLength(3);
  });

  it("auto dividends flow into the performance view (dividend cash flows)", async () => {
    const res = await app.request("/performance?range=ALL", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Smoke: the route computes with the auto rows present; exact numbers are
    // the performance suite's business.
    expect(body).toHaveProperty("twr");
  });

  it("PATCH autoAddDividends=false disables reconciliation; =true re-enables and forces a run", async () => {
    const off = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ autoAddDividends: false }),
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { autoAddDividends: boolean }).autoAddDividends).toBe(false);

    // New missing dividend + forced gate: still nothing happens while off.
    await tdb.db.insert(dividendHistory).values({
      symbol: "KO",
      exDate: "2026-06-01",
      amountPerShare: "0.46",
      currency: "USD",
      paymentDate: "2026-06-15",
      paymentDateEstimated: false,
      source: "test",
    });
    await forceNextRun();
    await app.request("/portfolio", { headers: { cookie } });
    const before = (await listTransactions()).filter((t) => t.source === "auto").length;

    // Re-enable: PATCH clears last_reconciled_at itself — no forceNextRun needed.
    const on = await app.request("/user/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ autoAddDividends: true }),
    });
    expect(on.status).toBe(200);
    await app.request("/portfolio", { headers: { cookie } });
    const after = (await listTransactions()).filter((t) => t.source === "auto").length;
    expect(after).toBe(before + 1);

    const settings = await app.request("/user/settings", { headers: { cookie } });
    expect(((await settings.json()) as { autoAddDividends: boolean }).autoAddDividends).toBe(true);
  });
});
