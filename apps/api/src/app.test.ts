import { describe, it, expect, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { createApp } from "./app";
import type { Database } from "./db/client";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import type { Auth } from "./auth";

const okDb = {
  execute: () => Promise.resolve([{ "?column?": 1 }]),
} as unknown as Database;

const failDb = {
  execute: () => Promise.reject(new Error("no db")),
} as unknown as Database;

const fakeAuth = {
  api: { getSession: vi.fn().mockResolvedValue(null) },
  handler: vi.fn(),
} as unknown as Auth;

describe("GET /health", () => {
  it("returns ok when the db responds", async () => {
    const res = await createApp(okDb, new FakeMarketDataProvider(), fakeAuth).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns degraded when the db errors", async () => {
    const res = await createApp(failDb, new FakeMarketDataProvider(), fakeAuth).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded" });
  });
});

describe("response compression", () => {
  it("gzips a JSON response when the client accepts it", async () => {
    const res = await createApp(okDb, new FakeMarketDataProvider(), fakeAuth).request(
      "/public-config",
      { headers: { "accept-encoding": "gzip" } },
    );
    expect(res.headers.get("content-encoding")).toBe("gzip");
    // Decode it rather than trusting the header: a wrongly-labelled body is
    // worse than an uncompressed one, and `res.json()` cannot tell us here —
    // `app.request` builds the Response directly, with no transport to decode.
    const body = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    expect(JSON.parse(body)).toEqual({ allowSignup: true, hasAccounts: true, mode: "open" });
  });

  it("leaves the body alone when the client does not accept an encoding", async () => {
    const res = await createApp(okDb, new FakeMarketDataProvider(), fakeAuth).request(
      "/public-config",
    );
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ allowSignup: true, hasAccounts: true, mode: "open" });
  });

  /** Drives the first-visitor redirect to /sign-up. The shared fake db has no
   *  `select`, so these bring their own stubs. */
  it("reports hasAccounts false while nobody has claimed the instance", async () => {
    const emptyDb = {
      execute: () => Promise.resolve([]),
      select: () => ({ from: () => ({ limit: () => Promise.resolve([]) }) }),
    } as unknown as Database;

    const res = await createApp(emptyDb, new FakeMarketDataProvider(), fakeAuth).request(
      "/public-config",
    );

    expect(await res.json()).toEqual({ allowSignup: true, hasAccounts: false, mode: "open" });
  });

  /** Unauthenticated and hit on every page load, and it answered without
   *  touching Postgres until hasAccounts arrived. A database blip must not turn
   *  it into a 500, and the safe guess only suppresses a redirect. */
  it("still answers when the database query fails", async () => {
    const brokenDb = {
      execute: () => Promise.resolve([]),
      select: () => ({
        from: () => ({ limit: () => Promise.reject(new Error("no db")) }),
      }),
    } as unknown as Database;

    const res = await createApp(brokenDb, new FakeMarketDataProvider(), fakeAuth).request(
      "/public-config",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowSignup: true, hasAccounts: true, mode: "open" });
  });

  // /public-config is ~40 bytes, far under the middleware's 1 kB default
  // threshold, and is compressed anyway. That is not an oversight: Hono
  // responds with a stream and no Content-Length, so the threshold has nothing
  // to measure. If this ever starts failing, the threshold has begun working
  // and the note in app.ts about /health costing 35 bytes is out of date.
  it("compresses even below the size threshold, because there is no Content-Length", async () => {
    const res = await createApp(okDb, new FakeMarketDataProvider(), fakeAuth).request("/health", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });
});

describe("GET /public-config", () => {
  it("defaults to open signup without auth", async () => {
    const res = await createApp(okDb, new FakeMarketDataProvider(), fakeAuth).request(
      "/public-config",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowSignup: true, hasAccounts: true, mode: "open" });
  });

  it("reports closed signup when configured", async () => {
    const res = await createApp(
      okDb,
      new FakeMarketDataProvider(),
      fakeAuth,
      undefined,
      undefined,
      undefined,
      { allowSignup: false },
    ).request("/public-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      allowSignup: false,
      hasAccounts: true,
      mode: "invite_only",
    });
  });
});
