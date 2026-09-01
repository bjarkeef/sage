import { describe, it, expect, vi } from "vitest";
import { retryLive } from "./live-retry";

/** Backoffs of 1ms: this suite must stay offline and fast. */
const FAST = [1, 1] as const;
const silent = () => {};

describe("retryLive", () => {
  it("returns the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retryLive(fn, FAST, silent)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("survives a single bad minute", async () => {
    // The 2026-09-01 shape: one HTTP 400, then the same call works.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Yahoo Finance request failed"))
      .mockResolvedValue("ok");
    await expect(retryLive(fn, FAST, silent)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("still fails when the upstream is genuinely down", async () => {
    // The alarm has to survive the retry, or the job stops being worth running.
    const fn = vi.fn().mockRejectedValue(new Error("upstream is down"));
    await expect(retryLive(fn, FAST, silent)).rejects.toThrow("upstream is down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error untouched, so the report is upstream's own", async () => {
    const last = new Error("Quote not found for symbol: NOPE");
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockRejectedValue(last);
    await expect(retryLive(fn, FAST, silent)).rejects.toBe(last);
  });

  it("waits between attempts", async () => {
    const gaps: number[] = [];
    let previous = Date.now();
    const fn = vi.fn().mockImplementation(() => {
      gaps.push(Date.now() - previous);
      previous = Date.now();
      return Promise.reject(new Error("nope"));
    });
    await expect(retryLive(fn, [30, 30], silent)).rejects.toThrow();
    // First call is immediate; the two retries wait. Timers are generous
    // downward only — assert a floor, never an exact duration.
    expect(gaps[1]).toBeGreaterThanOrEqual(20);
    expect(gaps[2]).toBeGreaterThanOrEqual(20);
  });

  it("reports each retry, so a flaky upstream is visible in the log", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await retryLive(fn, FAST, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toBe(1);
    expect((onRetry.mock.calls[0]![2] as Error).message).toBe("boom");
  });
});
