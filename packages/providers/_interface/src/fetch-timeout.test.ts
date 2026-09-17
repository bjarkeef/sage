import { describe, it, expect } from "vitest";
import { PROVIDER_FETCH_TIMEOUT_MS, timeoutFetch } from "./fetch-timeout";

/** A fetch that never answers on its own — only its signal can end it. */
function stalledFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason as Error));
    });
}

describe("timeoutFetch", () => {
  it("gives up on a request that never answers", async () => {
    const fetchFn = timeoutFetch(20, stalledFetch());
    const err = await fetchFn("https://stalled.test/").catch((e: unknown) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });

  it("returns the response when it arrives in time", async () => {
    const ok = new Response("{}");
    const fetchFn = timeoutFetch(1_000, () => Promise.resolve(ok));
    await expect(fetchFn("https://fast.test/")).resolves.toBe(ok);
  });

  it("still honours a signal the caller passed", async () => {
    const fetchFn = timeoutFetch(60_000, stalledFetch());
    const caller = new AbortController();
    const pending = fetchFn("https://stalled.test/", { signal: caller.signal });
    caller.abort(new Error("caller gave up"));
    await expect(pending).rejects.toThrow("caller gave up");
  });

  it("uses the global fetch at call time when no base is given", async () => {
    const original = globalThis.fetch;
    const ok = new Response("{}");
    const fetchFn = timeoutFetch(1_000);
    globalThis.fetch = () => Promise.resolve(ok);
    try {
      await expect(fetchFn("https://late-bound.test/")).resolves.toBe(ok);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("defaults to thirty seconds", () => {
    expect(PROVIDER_FETCH_TIMEOUT_MS).toBe(30_000);
  });
});
