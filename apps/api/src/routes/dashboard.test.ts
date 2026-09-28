import { describe, it, expect } from "vitest";
import { selectUpcoming, selectIncomeStream } from "./dashboard";

type AnnouncedRow = Parameters<typeof selectUpcoming>[0][number];
type ProjectedRow = Parameters<typeof selectUpcoming>[1][number];
type RetroactiveRow = Parameters<typeof selectIncomeStream>[0]["retroactive"][number];

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

type LongRangeRow = Parameters<typeof selectIncomeStream>[0]["longRange"][number];

function longRange(
  symbol: string,
  projectedExDate: string,
  paymentDate: string | null,
  income = "10.00",
): LongRangeRow {
  return {
    symbol,
    name: `${symbol} Inc`,
    projectedExDate,
    paymentDate,
    paymentDateEstimated: true,
    income,
    currency: "USD",
  } as LongRangeRow;
}

function stream(
  s: Partial<Parameters<typeof selectIncomeStream>[0]>,
  headlineCurrency: string | null = "USD",
) {
  return selectIncomeStream(
    { retroactive: [], announced: [], projected: [], longRange: [], ...s },
    { todayIso: TODAY, headlineCurrency },
  );
}

describe("selectIncomeStream", () => {
  it("tags each source with the certainty it represents", () => {
    const pts = stream({
      retroactive: [retro("O", fromToday(-30))],
      announced: [announced("KO", fromToday(5), fromToday(10))],
      projected: [projected("PG", fromToday(100), fromToday(105))],
      longRange: [longRange("MSFT", fromToday(500), fromToday(510))],
    });

    expect(pts.map((p) => [p.symbol, p.certainty])).toEqual([
      ["O", "paid"],
      ["KO", "confirmed"],
      ["PG", "estimated"],
      ["MSFT", "estimated"],
    ]);
  });

  it("tags an in-flight payment confirmed, not paid: the cash has not landed", () => {
    const pts = stream({
      retroactive: [retro("LANDED", fromToday(0)), retro("INFLIGHT", fromToday(4))],
    });

    expect(pts.map((p) => [p.symbol, p.certainty, p.headline])).toEqual([
      ["LANDED", "paid", "trailing"],
      ["INFLIGHT", "confirmed", "forward"],
    ]);
  });

  it("keeps the whole history and runs out through the long-range forecast", () => {
    const pts = stream({
      retroactive: [retro("OLD", fromToday(-2000)), retro("IN", fromToday(-300))],
      longRange: [longRange("FAR", fromToday(1100), fromToday(1100))],
    });

    expect(pts.map((p) => p.symbol)).toEqual(["OLD", "IN", "FAR"]);
  });

  it("names the headline window each point counts toward", () => {
    const pts = stream({
      retroactive: [
        retro("ANCIENT", fromToday(-400)),
        retro("RECENT", fromToday(-30)),
        // In flight: ex-date passed, cash still to land — the headline counts it forward.
        retro("INFLIGHT", fromToday(4)),
      ],
      announced: [announced("KO", fromToday(5), fromToday(10))],
      projected: [projected("PG", fromToday(300), fromToday(400))],
      longRange: [longRange("MSFT", fromToday(500), fromToday(510))],
    });

    expect(Object.fromEntries(pts.map((p) => [p.symbol, p.headline]))).toEqual({
      ANCIENT: null,
      RECENT: "trailing",
      INFLIGHT: "forward",
      KO: "forward",
      // Counted forward even though it pays after today + 365: the headline
      // selects projected rows by ex-date horizon, not by payment date.
      PG: "forward",
      MSFT: null,
    });
  });

  it("forward points sum to what the headline sums: announced + projected + in flight", () => {
    const retroactive = [
      retro("R", fromToday(-10), { income: "7.00" }),
      retro("F", fromToday(3), { income: "5.00" }),
    ];
    const ann = [announced("A", fromToday(5), fromToday(9), { income: "11.00" })];
    const proj = [projected("P", fromToday(200), fromToday(420), { income: "13.00" })];
    const pts = stream({ retroactive, announced: ann, projected: proj });

    const forward = pts
      .filter((p) => p.headline === "forward")
      .reduce((s, p) => s + Number(p.amount), 0);
    expect(forward).toBeCloseTo(5 + 11 + 13, 6);
  });

  it("drops points in any currency but the headline's, and returns nothing without one", () => {
    const eur = { ...retro("EUR", fromToday(-5)), currency: "EUR" };
    expect(
      stream({ retroactive: [eur, retro("USD", fromToday(-4))] }).map((p) => p.symbol),
    ).toEqual(["USD"]);
    expect(stream({ retroactive: [retro("USD", fromToday(-4))] }, null)).toEqual([]);
  });

  it("falls back to the ex-date when the payer named no payment date", () => {
    const ex = fromToday(-8);
    const [pt] = stream({ retroactive: [retro("O", null, { exDate: ex })] });
    expect(pt!.date).toBe(ex);
  });

  it("sorts ascending across all sources, not within each", () => {
    const pts = stream({
      retroactive: [retro("A", fromToday(-10))],
      announced: [announced("B", fromToday(-20), fromToday(-20))],
      projected: [projected("C", fromToday(-30), fromToday(-30))],
    });
    expect(pts.map((p) => p.symbol)).toEqual(["C", "B", "A"]);
  });

  it("drops zero-amount payments rather than drawing an invisible mark", () => {
    const pts = stream({
      retroactive: [retro("ZERO", fromToday(-5), { income: "0.00" }), retro("REAL", fromToday(-4))],
    });
    expect(pts.map((p) => p.symbol)).toEqual(["REAL"]);
  });

  it("keeps the newest points when the cap bites, dropping the oldest first", () => {
    const many = Array.from({ length: 4100 }, (_, i) => retro(`S${i}`, fromToday(-4100 + i)));
    const pts = stream({
      retroactive: many,
      projected: [projected("TOMORROW", fromToday(1), fromToday(1))],
    });

    expect(pts).toHaveLength(4000);
    expect(pts[0]!.symbol).toBe("S101");
    expect(pts.at(-1)?.symbol).toBe("TOMORROW");
  });
});
