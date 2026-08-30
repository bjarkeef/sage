import { describe, it, expect, vi, afterEach } from "vitest";
import { Decimal } from "@sage/core";
import { getRatesWithProvenance } from "./fx-provenance";

afterEach(() => vi.useRealTimers());

function serviceWith(latest: string | null) {
  return {
    getRate: vi.fn(),
    getRates: vi.fn().mockResolvedValue(new Map([["USD", new Decimal(1.1535)]])),
    latestDate: vi.fn().mockResolvedValue(latest),
  };
}

describe("getRatesWithProvenance", () => {
  it("reports fresh rates as not stale", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-07T12:00:00Z"));
    const tagged = await getRatesWithProvenance(serviceWith("2026-08-07"), "EUR", ["USD"]);
    expect(tagged.stale).toBe(false);
    expect(tagged.asOf).toBe("2026-08-07");
    expect(tagged.rates.get("USD")!.toFixed(4)).toBe("1.1535");
  });

  it("does not flag a weekend as stale", async () => {
    // Sunday, with Friday's publication as the newest row.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const tagged = await getRatesWithProvenance(serviceWith("2026-08-07"), "EUR", ["USD"]);
    expect(tagged.stale).toBe(false);
  });

  it("flags rates older than the 7-day threshold", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-08-20T12:00:00Z"));
    const tagged = await getRatesWithProvenance(serviceWith("2026-08-07"), "EUR", ["USD"]);
    expect(tagged.stale).toBe(true);
    expect(tagged.asOf).toBe("2026-08-07");
  });

  it("treats a service with no stored rates as not stale but unpriced", async () => {
    const tagged = await getRatesWithProvenance(serviceWith(null), "EUR", ["USD"]);
    expect(tagged.asOf).toBeNull();
    expect(tagged.stale).toBe(false);
  });

  it("falls back gracefully for a service without provenance", async () => {
    const plain = {
      getRate: vi.fn(),
      getRates: vi.fn().mockResolvedValue(new Map([["USD", new Decimal(1.1)]])),
    };
    const tagged = await getRatesWithProvenance(plain, "EUR", ["USD"]);
    expect(tagged.stale).toBe(false);
    expect(tagged.asOf).toBeNull();
    expect(tagged.rates.get("USD")!.toFixed(1)).toBe("1.1");
  });
});
