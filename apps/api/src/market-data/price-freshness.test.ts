import { describe, it, expect } from "vitest";
import {
  QUOTE_TTL_MS,
  BAR_TTL_MS,
  PRICES_STALE_AFTER_MS,
  isFresh,
  hasCoverage,
  arePricesStale,
  toIsoDay,
} from "./price-freshness";

const NOW = Date.now();
const agoMs = (ms: number) => new Date(NOW - ms);
const dayOffset = (days: number) => new Date(NOW + days * 86_400_000);

describe("the three durations stay distinct", () => {
  it("keeps the quote TTL far shorter than the bar TTL", () => {
    expect(QUOTE_TTL_MS).toBeLessThan(BAR_TTL_MS);
  });

  // BAR_TTL_MS and PRICES_STALE_AFTER_MS coincide at 24h today but mean
  // different things: a politeness budget toward the provider versus a promise
  // to the user. This asserts they are separately defined, so tuning one can
  // never silently move the other.
  it("defines the user-facing staleness threshold independently", () => {
    expect(PRICES_STALE_AFTER_MS).toBeGreaterThan(0);
    expect(QUOTE_TTL_MS).toBeLessThan(PRICES_STALE_AFTER_MS);
  });
});

describe("isFresh", () => {
  it("treats a recent fetch as fresh", () => {
    expect(isFresh(agoMs(60_000), NOW, QUOTE_TTL_MS)).toBe(true);
  });

  it("treats a fetch older than the TTL as not fresh", () => {
    expect(isFresh(agoMs(QUOTE_TTL_MS + 1000), NOW, QUOTE_TTL_MS)).toBe(false);
  });

  it("treats a missing fetch as not fresh", () => {
    expect(isFresh(null, NOW, QUOTE_TTL_MS)).toBe(false);
  });
});

describe("hasCoverage", () => {
  it("is true when stored days span the requested window", () => {
    expect(
      hasCoverage(toIsoDay(dayOffset(-40)), toIsoDay(dayOffset(0)), dayOffset(-30), dayOffset(0)),
    ).toBe(true);
  });

  it("is false when storage starts after the window does", () => {
    expect(
      hasCoverage(toIsoDay(dayOffset(-10)), toIsoDay(dayOffset(0)), dayOffset(-30), dayOffset(0)),
    ).toBe(false);
  });

  it("is false when storage ends before the window does", () => {
    expect(
      hasCoverage(toIsoDay(dayOffset(-40)), toIsoDay(dayOffset(-5)), dayOffset(-30), dayOffset(0)),
    ).toBe(false);
  });

  it("is false when nothing is stored", () => {
    expect(hasCoverage(null, null, dayOffset(-30), dayOffset(0))).toBe(false);
  });
});

describe("arePricesStale", () => {
  it("is false for a recent fetch", () => {
    expect(arePricesStale(agoMs(60_000), NOW)).toBe(false);
  });

  it("is true past the threshold", () => {
    expect(arePricesStale(agoMs(PRICES_STALE_AFTER_MS + 1000), NOW)).toBe(true);
  });

  // Nothing stored is not the same as stale: a brand-new instance has no prices
  // yet and must not accuse itself of being out of date.
  it("is false when nothing is stored", () => {
    expect(arePricesStale(null, NOW)).toBe(false);
  });
});
