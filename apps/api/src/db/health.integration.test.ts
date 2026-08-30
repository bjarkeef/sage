import { it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createApp } from "../app";
import { describeDb, withTestDb, fakeAuth, type TestDb } from "../testing";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";

describeDb("/health (integration)", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await withTestDb();
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  it("returns ok wired to a real Postgres", async () => {
    const res = await createApp(testDb.db, new FakeMarketDataProvider(), fakeAuth()).request(
      "/health",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("executes a real query against the container", async () => {
    const rows = await testDb.db.execute(sql`select 1 as value`);
    expect(rows[0]).toMatchObject({ value: 1 });
  });
});
