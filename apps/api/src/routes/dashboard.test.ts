import { describe, it, expect } from "vitest";
import { selectUpcoming, selectIncomeStream } from "./dashboard";

type AnnouncedRow = Parameters<typeof selectUpcoming>[0][number];
type ProjectedRow = Parameters<typeof selectUpcoming>[1][number];
type RetroactiveRow = Parameters<typeof selectIncomeStream>[0][number];

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

function retro(
  symbol: string,
  paymentDate: string | null,
  opts: { exDate?: string; income?: string } = {},
): RetroactiveRow {
  return {
    symbol,
    name: `${symbol} Inc`,
    exDate: opts.exDate ?? paymentDate ?? TODAY,
    paymentDate,
    paymentDateEstimated: false,
    amountPerShare: "0.25",
    sharesHeld: "40",
    income: opts.income ?? "10.00",
    currency: "USD",
  };
}

describe("selectIncomeStream", () => {
  it("tags each source array with the certainty it represents", () => {
    const pts = selectIncomeStream(
      [retro("O", fromToday(-30))],
      [announced("KO", fromToday(5), fromToday(10))],
      [projected("PG", fromToday(100), fromToday(105))],
      TODAY,
    );

    expect(pts.map((p) => [p.symbol, p.certainty])).toEqual([
      ["O", "paid"],
      ["KO", "confirmed"],
      ["PG", "estimated"],
    ]);
  });

  it("spans twelve months either side of today and drops what falls outside", () => {
    const pts = selectIncomeStream(
      [retro("OLD", fromToday(-400)), retro("IN", fromToday(-300))],
      [],
      [projected("FAR", fromToday(400), fromToday(400))],
      TODAY,
    );

    expect(pts.map((p) => p.symbol)).toEqual(["IN"]);
  });

  it("falls back to the ex-date when the payer named no payment date", () => {
    // Same fallback selectUpcoming uses. If these two ever diverge, one payment
    // renders on two different days depending on which component drew it.
    const ex = fromToday(-8);
    const [pt] = selectIncomeStream([retro("O", null, { exDate: ex })], [], [], TODAY);

    expect(pt!.date).toBe(ex);
  });

  it("sorts ascending across all three sources, not within each", () => {
    const pts = selectIncomeStream(
      [retro("A", fromToday(-10))],
      [announced("B", fromToday(-20), fromToday(-20))],
      [projected("C", fromToday(-30), fromToday(-30))],
      TODAY,
    );

    expect(pts.map((p) => p.symbol)).toEqual(["C", "B", "A"]);
  });

  it("drops zero-amount payments rather than drawing an invisible mark", () => {
    const pts = selectIncomeStream(
      [retro("ZERO", fromToday(-5), { income: "0.00" }), retro("REAL", fromToday(-4))],
      [],
      [],
      TODAY,
    );

    expect(pts.map((p) => p.symbol)).toEqual(["REAL"]);
  });

  it("keeps the forward half when the cap bites, dropping the oldest first", () => {
    // 900 payments, all in the past year, oldest first — over the 800 cap.
    const many = Array.from({ length: 900 }, (_, i) =>
      retro(`S${i}`, fromToday(-360 + Math.floor(i / 3))),
    );
    const pts = selectIncomeStream(
      many,
      [],
      [projected("TOMORROW", fromToday(1), fromToday(1))],
      TODAY,
    );

    expect(pts).toHaveLength(800);
    expect(pts.at(-1)?.symbol).toBe("TOMORROW");
  });
});
