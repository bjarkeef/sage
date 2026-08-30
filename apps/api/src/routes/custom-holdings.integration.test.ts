import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";

async function signUp(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Custom Holdings User",
      email,
      password: "test-password-at-least-8-chars",
    }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status}`);
  return res.headers.get("set-cookie")!;
}

describeDb("/custom-holdings", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    tdb = await withTestDb();
    const provider = new FakeMarketDataProvider({ quotes: {} });
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, provider, auth);
    cookie = await signUp(app, "custom-holdings-user@example.com");
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("creates, reads, updates a custom holding and manages price marks", async () => {
    const createRes = await app.request("/custom-holdings", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        symbol: "CASH_DKK",
        name: "Cash account",
        currency: "DKK",
        holdingType: "savings",
        sector: "Cash",
        country: "Denmark",
        note: "bank",
        income: {
          yearlyPct: "4.25",
          frequencyUnit: "quarter",
          frequencyInterval: 1,
          firstPaymentDate: "2026-04-30",
          lastPaymentDate: "2041-05-01",
          reinvest: true,
          autoAdd: true,
        },
      }),
    });
    expect(createRes.status).toBe(201);

    const getRes = await app.request("/custom-holdings/CASH_DKK", { headers: { cookie } });
    expect(getRes.status).toBe(200);
    const dto = (await getRes.json()) as {
      incomeEnabled: boolean;
      income: { frequencyUnit: string };
    };
    expect(dto.incomeEnabled).toBe(true);
    expect(dto.income.frequencyUnit).toBe("quarter");

    const putRes = await app.request("/custom-holdings/CASH_DKK", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "DKK bank",
        holdingType: "savings",
        note: null,
        sector: "Cash",
        country: "Denmark",
        income: {
          yearlyPct: "3.10",
          frequencyUnit: "quarter",
          frequencyInterval: 1,
          firstPaymentDate: "2026-04-30",
          lastPaymentDate: null,
          reinvest: true,
          autoAdd: true,
        },
      }),
    });
    expect(putRes.status).toBe(200);

    const markRes = await app.request("/custom-holdings/CASH_DKK/prices", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ date: "2026-07-18", price: "1" }),
    });
    expect(markRes.status).toBe(200);

    const delRes = await app.request("/custom-holdings/CASH_DKK/prices/2026-07-18", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(delRes.status).toBe(200);
  });

  it("404s for non-custom symbols and duplicate creates conflict", async () => {
    expect((await app.request("/custom-holdings/AAPL", { headers: { cookie } })).status).toBe(404);
    const dup = await app.request("/custom-holdings", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        symbol: "CASH_DKK",
        name: "x",
        currency: "DKK",
        holdingType: "savings",
      }),
    });
    expect(dup.status).toBe(409);
  });
});
