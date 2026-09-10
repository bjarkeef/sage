import { describe, it, expect } from "vitest";
import { selectUpcoming } from "./dashboard";

type AnnouncedRow = Parameters<typeof selectUpcoming>[0][number];
type ProjectedRow = Parameters<typeof selectUpcoming>[1][number];

/** n days from the moment the suite runs, in UTC — never a literal date, so
 *  this file can't rot into a past-dated fixture the way a hardcoded string
 *  would (see CLAUDE.md's self-expiring-tests note). */
function fromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const TODAY = fromToday(0);

function announced(
  symbol: string,
  exDate: string,
  paymentDate: string | null,
  opts: { paymentDateEstimated?: boolean; income?: string } = {},
): AnnouncedRow {
  return {
    symbol,
    name: `${symbol} Inc`,
    exDate,
    paymentDate,
    paymentDateEstimated: opts.paymentDateEstimated ?? false,
    income: opts.income ?? "10.00",
    currency: "USD",
  } as AnnouncedRow;
}

function projected(
  symbol: string,
  projectedExDate: string,
  paymentDate: string | null,
  opts: { paymentDateEstimated?: boolean; income?: string } = {},
): ProjectedRow {
  return {
    symbol,
    name: `${symbol} Inc`,
    projectedExDate,
    paymentDate,
    paymentDateEstimated: opts.paymentDateEstimated ?? false,
    income: opts.income ?? "10.00",
    currency: "USD",
  } as ProjectedRow;
}

describe("selectUpcoming", () => {
  it("merges announced and projected, ordered by date", () => {
    const rows = selectUpcoming(
      [announced("O", fromToday(10), fromToday(10))],
      [projected("MPAY", fromToday(5), fromToday(5))],
      TODAY,
    );
    expect(rows.map((r) => r.symbol)).toEqual(["MPAY", "O"]);
  });

  it("marks a projected payment and an estimated date separately", () => {
    // Announced-but-estimated and projected-but-declared are different facts;
    // pick opposite values on the two rows so a selector that conflates them
    // (e.g. sets dateEstimated = projected) cannot pass by accident.
    const rows = selectUpcoming(
      [announced("O", fromToday(5), fromToday(5), { paymentDateEstimated: true })],
      [projected("MPAY", fromToday(10), fromToday(10), { paymentDateEstimated: false })],
      TODAY,
    );
    const o = rows.find((r) => r.symbol === "O")!;
    const mpay = rows.find((r) => r.symbol === "MPAY")!;
    expect(o).toMatchObject({ dateEstimated: true, projected: false });
    expect(mpay).toMatchObject({ dateEstimated: false, projected: true });
  });

  it("selects and sorts on the date it will display, not the ex-date", () => {
    // exDate is in the past — the old code filtered on exDate >= today and
    // would have dropped this row entirely. paymentDate is in the future and
    // is what the card actually renders (paymentDate ?? exDate); the new
    // selector must key off that instead.
    const rows = selectUpcoming([announced("O", fromToday(-5), fromToday(5))], [], TODAY);
    expect(rows.map((r) => r.symbol)).toEqual(["O"]);
    expect(rows[0]!.date).toBe(fromToday(5));
  });

  it("windows to 30 days, capped at 5", () => {
    const rows = selectUpcoming(
      [
        announced("A", fromToday(1), fromToday(1)),
        announced("B", fromToday(5), fromToday(5)),
        announced("C", fromToday(10), fromToday(10)),
        announced("D", fromToday(15), fromToday(15)),
        announced("E", fromToday(20), fromToday(20)),
        announced("F", fromToday(25), fromToday(25)),
      ],
      [],
      TODAY,
    );
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("reaches past 30 days rather than render fewer than 3", () => {
    const rows = selectUpcoming(
      [
        announced("A", fromToday(5), fromToday(5)),
        announced("B", fromToday(10), fromToday(10)),
        announced("FAR", fromToday(45), fromToday(45)), // outside the 30-day window
      ],
      [],
      TODAY,
    );
    // Only 2 of the 3 rows fall inside the 30-day window — below the floor of
    // 3 — so the selector must reach past the window rather than render just
    // the 2 that fit inside it.
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "FAR"]);
  });

  it("returns what exists when the book has fewer than three ahead", () => {
    const rows = selectUpcoming([announced("A", fromToday(5), fromToday(5))], [], TODAY);
    expect(rows.map((r) => r.symbol)).toEqual(["A"]);
  });

  it("excludes anything already paid", () => {
    const rows = selectUpcoming(
      [announced("PAID", fromToday(-1), fromToday(-1)), announced("O", fromToday(5), fromToday(5))],
      [projected("GONE", fromToday(-10), fromToday(-10))],
      TODAY,
    );
    expect(rows.map((r) => r.symbol)).toEqual(["O"]);
  });
});
