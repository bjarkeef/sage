import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  formatShares,
  formatDate,
  formatRelativeTime,
  formatSecondsAgo,
  formatUptime,
} from "./format";

describe("formatUptime", () => {
  it("reports seconds under a minute, so a just-restarted API is obvious", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(45)).toBe("45s");
  });

  it("drops to minutes, then hours, keeping one unit of detail", () => {
    expect(formatUptime(60)).toBe("1m");
    expect(formatUptime(3599)).toBe("59m");
    expect(formatUptime(3600)).toBe("1h 0m");
    expect(formatUptime(8040)).toBe("2h 14m");
  });

  it("reports days once past 24h", () => {
    expect(formatUptime(86_400)).toBe("1d 0h");
    expect(formatUptime(180_000)).toBe("2d 2h");
  });

  it("treats a negative or non-finite reading as unknown rather than rendering nonsense", () => {
    expect(formatUptime(-5)).toBe("—");
    expect(formatUptime(Number.NaN)).toBe("—");
  });
});

describe("formatSecondsAgo", () => {
  it("reports null as unknown", () => {
    expect(formatSecondsAgo(null)).toBe("—");
  });

  it("stays in seconds up to the minute boundary", () => {
    expect(formatSecondsAgo(59)).toBe("59s ago");
    expect(formatSecondsAgo(60)).toBe("1m ago");
  });

  it("stays in minutes up to the hour boundary", () => {
    expect(formatSecondsAgo(3599)).toBe("59m ago");
    expect(formatSecondsAgo(3600)).toBe("1h ago");
  });

  it("stays in hours up to the day boundary", () => {
    expect(formatSecondsAgo(86_399)).toBe("23h ago");
    expect(formatSecondsAgo(86_400)).toBe("1d ago");
  });
});

describe("formatQuantity", () => {
  it("trims broker-precision decimals to 4 places", () => {
    expect(formatQuantity("2.3118999998786098398863788101336506")).toBe("2.3119");
  });

  it("leaves integers alone", () => {
    expect(formatQuantity("10")).toBe("10");
  });

  it("drops trailing zeros", () => {
    expect(formatQuantity("0.5000")).toBe("0.5");
  });

  it("groups thousands", () => {
    expect(formatQuantity("1234.56789")).toBe("1,234.5679");
  });

  it("passes non-numeric input through unchanged", () => {
    expect(formatQuantity("n/a")).toBe("n/a");
  });
});

describe("formatDate", () => {
  it("renders month day for the current year", () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-05-11`;
    expect(formatDate(iso)).toBe("May 11");
  });

  it("appends the year for other years", () => {
    expect(formatDate("2024-05-11")).toBe("May 11, 2024");
  });

  it("year: 'always' forces the year", () => {
    const now = new Date();
    expect(formatDate(`${now.getFullYear()}-01-02`, { year: "always" })).toBe(
      `Jan 2, ${now.getFullYear()}`,
    );
  });

  it("returns invalid input unchanged", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-23T12:00:00Z");

  it("says 'just now' under a minute", () => {
    expect(formatRelativeTime("2026-07-23T11:59:30Z", now)).toBe("just now");
  });
  it("counts minutes", () => {
    expect(formatRelativeTime("2026-07-23T11:45:00Z", now)).toBe("15m ago");
  });
  it("counts hours", () => {
    expect(formatRelativeTime("2026-07-23T09:00:00Z", now)).toBe("3h ago");
  });
  it("counts days", () => {
    expect(formatRelativeTime("2026-07-21T12:00:00Z", now)).toBe("2d ago");
  });
  it("falls back to an absolute date a week or more out", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", now)).toMatch(/^Jun 1/);
  });
  it("returns invalid input unchanged", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("not-a-date");
  });
});

describe("formatShares", () => {
  it("drops decimals a five-figure count cannot carry", () => {
    expect(formatShares("41250.6633")).toBe("41,251");
  });
  it("allows two decimals in the hundreds", () => {
    expect(formatShares("102.5")).toBe("102.5");
    expect(formatShares("102.5678")).toBe("102.57");
  });
  it("keeps four decimals for fractional ETF lots", () => {
    expect(formatShares("24.1487")).toBe("24.1487");
  });
  it("removes trailing zeros", () => {
    expect(formatShares("14.0000")).toBe("14");
  });
  it("handles the band edges", () => {
    expect(formatShares("100")).toBe("100");
    expect(formatShares("9999.999")).toBe("10,000");
    expect(formatShares("10000.4")).toBe("10,000");
  });
  it("returns the input unchanged when it is not a number", () => {
    expect(formatShares("n/a")).toBe("n/a");
  });
  it("leaves formatQuantity alone for prices", () => {
    expect(formatQuantity("0.0521")).toBe("0.0521");
  });
});
