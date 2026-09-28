import { describe, it, expect } from "vitest";
import {
  dayToIso,
  isoToDay,
  monthKeyOfDay,
  monthKeyStartDay,
  sameDayLastYear,
  toTapePoints,
  yearOfDay,
  yearStartDay,
} from "./points";

describe("day arithmetic", () => {
  it("round-trips ISO dates through day numbers", () => {
    for (const iso of ["2019-01-01", "2024-02-29", "2026-09-28", "2029-12-31"]) {
      expect(dayToIso(isoToDay(iso))).toBe(iso);
    }
  });

  it("knows years and months", () => {
    const d = isoToDay("2026-09-28");
    expect(yearOfDay(d)).toBe(2026);
    expect(dayToIso(yearStartDay(2026))).toBe("2026-01-01");
    expect(monthKeyOfDay(d)).toBe(2026 * 12 + 8);
    expect(dayToIso(monthKeyStartDay(2026 * 12 + 8))).toBe("2026-09-01");
  });

  it("maps a leap day to 28 February a year earlier", () => {
    expect(dayToIso(sameDayLastYear(isoToDay("2028-02-29")))).toBe("2027-02-28");
    expect(dayToIso(sameDayLastYear(isoToDay("2026-09-28")))).toBe("2025-09-28");
  });
});

describe("toTapePoints", () => {
  it("nets amounts by the tax rate and sorts by day", () => {
    const pts = toTapePoints(
      [
        {
          date: "2026-05-01",
          amount: "100.00",
          currency: "DKK",
          symbol: "KO",
          certainty: "estimated",
          headline: "forward",
        },
        {
          date: "2026-01-01",
          amount: "40.00",
          currency: "DKK",
          symbol: "O",
          certainty: "paid",
          headline: "trailing",
        },
      ],
      25,
    );
    expect(pts.map((p) => [p.symbol, p.amount, p.headline])).toEqual([
      ["O", 30, "trailing"],
      ["KO", 75, "forward"],
    ]);
  });
});
