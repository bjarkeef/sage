import { describe, it, expect } from "vitest";
import { cutNotes, perShareByYear, MAX_PAST_YEARS } from "./income-by-year";
import { TODAY } from "../test/asset-fixtures";
import type { AssetUpcomingDTO } from "../types";

const Y = Number(TODAY.slice(0, 4)); // TODAY is mid-June

const paid = (date: string, amount: string, currency = "USD") => ({
  exDate: date,
  paymentDate: date,
  amountPerShare: amount,
  currency,
});
const quarterOf = (year: number, amount: string) =>
  ["02-10", "05-10", "08-10", "11-10"].map((md) => paid(`${year}-${md}`, amount));
const ahead = (
  paymentDate: string,
  amount: string,
  certainty: AssetUpcomingDTO["certainty"],
  window: AssetUpcomingDTO["window"],
): AssetUpcomingDTO => ({
  exDate: paymentDate,
  paymentDate,
  amountPerShare: amount,
  currency: "USD",
  certainty,
  window,
});

const HISTORY = [
  paid(`${Y - 5}-11-10`, "0.40"), // first year: one payment
  ...quarterOf(Y - 4, "0.40"), // 1.60
  ...quarterOf(Y - 3, "0.275"), // 1.10 — cut 31%
  ...quarterOf(Y - 2, "0.30"), // 1.20
  ...quarterOf(Y - 1, "0.30"), // 1.20
  paid(`${Y}-02-10`, "0.30"),
  paid(`${Y}-05-10`, "0.30"),
];
const UPCOMING = [
  ahead(`${Y}-08-10`, "0.30", "confirmed", "next12m"),
  ahead(`${Y}-11-10`, "0.30", "estimated", "next12m"),
  ahead(`${Y + 1}-02-10`, "0.31", "estimated", "next12m"),
  ahead(`${Y + 1}-05-10`, "0.31", "estimated", "next12m"),
  ahead(`${Y + 1}-08-10`, "0.31", "estimated", "longRange"),
  ahead(`${Y + 1}-11-10`, "0.31", "estimated", "longRange"),
  ahead(`${Y + 2}-02-10`, "0.32", "estimated", "longRange"), // past the forecast year
];

describe("perShareByYear", () => {
  const { years, leftOut } = perShareByYear({
    history: HISTORY,
    upcoming: UPCOMING,
    currency: "USD",
    todayISO: TODAY,
  });
  const byYear = (y: number) => years.find((b) => b.year === y)!;

  it("runs from the first paying year to one forecast year", () => {
    expect(years.map((b) => [b.year, b.kind])).toEqual([
      [Y - 5, "past"],
      [Y - 4, "past"],
      [Y - 3, "past"],
      [Y - 2, "past"],
      [Y - 1, "past"],
      [Y, "current"],
      [Y + 1, "forecast"],
    ]);
    expect(leftOut).toBe(0);
  });

  it("marks a first year with fewer payments than the next as partial, and measures no cut from it", () => {
    expect(byYear(Y - 5).partial).toBe(true);
    expect(byYear(Y - 4).cutPct).toBeNull();
  });

  it("marks a complete past year that paid less than the one before as cut", () => {
    expect(byYear(Y - 3).cutPct).toBeCloseTo(-31.25, 6);
    expect(byYear(Y - 2).cutPct).toBeNull();
    expect(byYear(Y - 1).cutPct).toBeNull(); // equal is not a cut
    expect(cutNotes(years)).toEqual([`${Y - 3} was cut 31%`]);
  });

  it("splits the current year into paid and still to come, by certainty", () => {
    const cur = byYear(Y);
    expect(cur.paid).toBeCloseTo(0.6, 10);
    expect(cur.confirmed).toBeCloseTo(0.3, 10);
    expect(cur.estimated).toBeCloseTo(0.3, 10);
    expect(cur.total).toBeCloseTo(1.2, 10);
  });

  it("fills the forecast year from both windows, and nothing past it", () => {
    expect(byYear(Y + 1).estimated).toBeCloseTo(1.24, 10);
    expect(years.some((b) => b.year === Y + 2)).toBe(false);
  });

  it("counts a payment in flight once — upcoming carries it, not history", () => {
    const inFlight = {
      exDate: `${Y}-06-01`,
      paymentDate: `${Y}-06-20`,
      amountPerShare: "0.30",
      currency: "USD",
    };
    const r = perShareByYear({
      history: [...HISTORY, inFlight],
      upcoming: [ahead(`${Y}-06-20`, "0.30", "confirmed", "next12m"), ...UPCOMING],
      currency: "USD",
      todayISO: TODAY,
    });
    const cur = r.years.find((b) => b.year === Y)!;
    expect(cur.paid).toBeCloseTo(0.6, 10);
    expect(cur.confirmed).toBeCloseTo(0.6, 10);
  });

  it("flags a year paying more than 3× the year before", () => {
    const r = perShareByYear({
      history: [...quarterOf(Y - 2, "0.30"), ...quarterOf(Y - 1, "1.00")],
      upcoming: [],
      currency: "USD",
      todayISO: TODAY,
    });
    expect(r.years.find((b) => b.year === Y - 1)!.flag?.reason).toContain("3×");
    expect(r.years.find((b) => b.year === Y - 2)!.flag).toBeNull();
  });

  it("leaves out — and counts — payments in another currency", () => {
    const r = perShareByYear({
      history: [...HISTORY, paid(`${Y - 1}-12-01`, "9.00", "GBP")],
      upcoming: UPCOMING,
      currency: "USD",
      todayISO: TODAY,
    });
    expect(r.leftOut).toBe(1);
    expect(r.years.find((b) => b.year === Y - 1)!.total).toBeCloseTo(1.2, 10);
  });

  it(`shows at most ${MAX_PAST_YEARS} past years`, () => {
    const long = Array.from({ length: 15 }, (_, i) => quarterOf(Y - 15 + i, "0.30")).flat();
    const r = perShareByYear({ history: long, upcoming: [], currency: "USD", todayISO: TODAY });
    expect(r.years[0]!.year).toBe(Y - MAX_PAST_YEARS);
  });

  it("measures no cut between equal years whose payments sum differently in floating point", () => {
    const r = perShareByYear({
      history: [
        ...["02-10", "06-10", "11-10"].map((md) => paid(`${Y - 2}-${md}`, "0.40")),
        ...quarterOf(Y - 1, "0.30"),
      ],
      upcoming: [],
      currency: "USD",
      todayISO: TODAY,
    });
    expect(r.years.find((b) => b.year === Y - 1)!.cutPct).toBeNull();
    expect(cutNotes(r.years)).toEqual([]);
  });

  it("does not mark a drop that rounds to 0% as a cut", () => {
    const r = perShareByYear({
      history: [...quarterOf(Y - 2, "0.30"), ...quarterOf(Y - 1, "0.2996")],
      upcoming: [],
      currency: "USD",
      todayISO: TODAY,
    });
    const bar = r.years.find((b) => b.year === Y - 1)!;
    expect(bar.total).toBeLessThan(r.years.find((b) => b.year === Y - 2)!.total);
    expect(bar.cutPct).toBeNull();
    expect(cutNotes(r.years)).toEqual([]);
  });

  it("marks a new payer's part-year first year partial when the next year is the current one", () => {
    const r = perShareByYear({
      history: [
        paid(`${Y - 1}-11-10`, "0.40"),
        paid(`${Y}-02-10`, "0.40"),
        paid(`${Y}-05-10`, "0.40"),
      ],
      upcoming: [
        ahead(`${Y}-08-10`, "0.40", "confirmed", "next12m"),
        ahead(`${Y}-11-10`, "0.40", "estimated", "next12m"),
      ],
      currency: "USD",
      todayISO: TODAY,
    });
    expect(r.years[0]!.partial).toBe(true);
    const cur = r.years.find((b) => b.year === Y)!;
    expect(cur.flag).toBeNull();
    expect(cur.total).toBeCloseTo(1.6, 10);
  });

  it("has nothing for a holding that never paid", () => {
    expect(
      perShareByYear({ history: [], upcoming: [], currency: "USD", todayISO: TODAY }).years,
    ).toEqual([]);
  });
});
