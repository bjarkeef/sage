import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, type TestDb } from "./testing";
import { createAuth, getUserPortfolio } from "./auth";
import { createApp } from "./app";
import { account } from "./db/schema";

describeDb("auth flow", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
  }, 120_000);
  afterAll(async () => {
    await tdb?.stop();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/portfolio");
    expect(res.status).toBe(401);
  });

  it("allows access to /health without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("sign-up creates a user and a default portfolio", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        password: "strong-password-123",
      }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    // Verify portfolio was created for the user
    const body = (await res.json()) as { user: { id: string } };
    const portfolio = await getUserPortfolio(tdb.db, body.user.id);
    expect(portfolio.id).toBeTruthy();
  });

  // The value migration 0028 backfills onto pre-1.7 rows has to be the value
  // better-auth itself writes, or a migrated account is a different identity
  // from a fresh one under the (issuer, account_id) uniqueness better-auth
  // declares. This asserts the literal rather than trusting the upgrade guide:
  // if better-auth ever changes what `createLocalAccountIssuer("credential")`
  // produces, the backfill in 0028 is wrong and this fails.
  it("writes the issuer that migration 0028 backfills onto legacy rows", async () => {
    const rows = await tdb.db
      .select({ issuer: account.issuer, providerId: account.providerId })
      .from(account);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.providerId).toBe("credential");
      expect(row.issuer).toBe("local:credential");
    }
  });

  it("sign-in returns a session cookie", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "strong-password-123",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("authenticated user can access portfolio", async () => {
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "strong-password-123",
      }),
    });
    const cookie = signIn.headers.get("set-cookie")!;

    const res = await app.request("/portfolio", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: unknown[] };
    expect(body.positions).toEqual([]);
  });
});
