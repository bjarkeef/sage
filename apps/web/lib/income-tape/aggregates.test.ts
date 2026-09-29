import { describe, it, expect } from "vitest";
import {
  changePct,
  ghostOf,
  indexBySymbol,
  isPartialYear,
  measureTotals,
  monthTotals,
  payerSummary,
  rankPayers,
  yearTotals,
} from "./aggregates";
import { isoToDay, type TapePoint } from "./points";

function p(
  iso: string,
  symbol: string,
  amount: number,
  certainty: TapePoint["certainty"] = "paid",
  headline: TapePoint["headline"] = null,
): TapePoint {
  return { day: isoToDay(iso), iso, symbol, amount, certainty, headline };
}

const today = isoToDay("2026-09-28");
const PTS = [
  p("2025-06-10", "KO", 90),
  p("2025-09-15", "O", 30, "paid"),
  p("2026-06-12", "KO", 99, "paid", "trailing"),
  p("2026-09-15", "O", 31, "paid", "trailing"),
  p("2026-10-15", "O", 32, "confirmed", "forward"),
  p("2027-06-11", "KO", 104, "estimated", "forward"),
];

describe("measureTotals", () => {
  it("sums a window and splits it by certainty", () => {
    const t = measureTotals(
      PTS,
      { kind: "window", from: isoToDay("2026-01-01"), to: isoToDay("2027-01-01") },
      null,
    );
    expect(t).toEqual({ total: 162, paid: 130, confirmed: 32, estimated: 0, count: 3 });
  });

  it("sums the headline-tagged points", () => {
    expect(measureTotals(PTS, { kind: "headline", tag: "forward" }, null).total).toBe(136);
    expect(measureTotals(PTS, { kind: "headline", tag: "trailing" }, null).total).toBe(130);
  });

  it("narrows to a focused payer", () => {
    expect(measureTotals(PTS, { kind: "headline", tag: "forward" }, "O").total).toBe(32);
  });
});

describe("changePct", () => {
  it("is null without a prior figure, never +Infinity", () => {
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(110, 100)).toBeCloseTo(10);
  });
});

describe("month and year totals", () => {
  it("buckets by calendar month and year", () => {
    const m = monthTotals(PTS, null);
    expect(m.get(2026 * 12 + 8)).toBe(31);
    const y = yearTotals(PTS, "KO");
    expect(y.get(2026)?.total).toBe(99);
    expect(y.get(2027)?.estimated).toBe(104);
  });
});

describe("ghostOf", () => {
  const index = indexBySymbol(PTS);
  it("finds the same payer's payment about a year earlier, across a shifted pay date", () => {
    expect(ghostOf(PTS[2]!, index)?.iso).toBe("2025-06-10");
  });
  it("finds nothing when there was no such payment", () => {
    expect(ghostOf(PTS[0]!, index)).toBeNull();
  });
});

describe("payers", () => {
  it("ranks by next-12-month income", () => {
    expect(rankPayers(PTS).map((r) => r.symbol)).toEqual(["KO", "O"]);
  });

  it("summarises one payer for the focus card", () => {
    const s = payerSummary(PTS, "O", today);
    expect(s.next?.iso).toBe("2026-10-15");
    expect(s.last12).toBe(31);
    expect(s.next12).toBe(32);
    expect(s.changePct).toBeCloseTo((31 / 30 - 1) * 100);
    expect(s.share).toBeCloseTo(32 / 136);
    expect(s.frequency).toBe("pays once a year");
  });
});

describe("payer windows follow the headline tags, as the HUD does", () => {
  // PG's projected payment is counted forward by ex-date though its cash lands
  // after today + 365; the untagged points sit inside the date windows but
  // belong to no headline. The HUD sums tags, so the chips and card must too.
  const tagged = [
    ...PTS,
    p("2027-11-20", "PG", 40, "estimated", "forward"),
    p("2027-09-01", "PG", 7, "estimated", null),
    p("2026-01-10", "PG", 20, "paid", "trailing"),
    p("2025-12-20", "PG", 9, "paid", null),
  ];

  it("sums next 12 and share over forward-tagged points", () => {
    const s = payerSummary(tagged, "PG", today);
    expect(s.next12).toBe(40);
    expect(s.share).toBeCloseTo(40 / (136 + 40));
    expect(rankPayers(tagged).find((r) => r.symbol === "PG")?.next12).toBe(40);
  });

  it("sums last 12 over trailing-tagged points and compares with the prior 12 by date", () => {
    const s = payerSummary(tagged, "PG", today);
    expect(s.last12).toBe(20);
    // Prior 12 (2024-09-29 to 2025-09-28) holds nothing for PG: no change figure.
    expect(s.changePct).toBeNull();
  });
});

describe("isPartialYear", () => {
  const extent = { firstDay: isoToDay("2019-03-15"), lastDay: isoToDay("2029-12-31") };
  it("flags a first year that started late and nothing else", () => {
    expect(isPartialYear(2019, extent)).toBe(true);
    expect(isPartialYear(2020, extent)).toBe(false);
    expect(isPartialYear(2029, extent)).toBe(false);
    expect(isPartialYear(2029, { ...extent, lastDay: isoToDay("2029-09-30") })).toBe(true);
  });
});
