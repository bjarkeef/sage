import { describe, expect, it } from "vitest";
import {
  composeBrief,
  composeColorLine,
  marketState,
  marketStateLine,
  type BriefSegment,
} from "./brief";

describe("composeBrief", () => {
  const segmentsToString = (segments: BriefSegment[]): string =>
    segments.map((s) => s.text).join("");

  it("1. payday beats mover: input with both paydays and mover → payday clause, no mover text, no next-payout", () => {
    const result = composeBrief({
      totalValue: "1.284.502 kr",
      todayChange: { amount: "+4.120 kr", percent: 0.32 },
      mover: { symbol: "NORDA-B", percent: 2.5 },
      paydays: [{ symbol: "MPAY", income: "312 kr" }],
      paydaysTotal: "312 kr",
      nextPayout: { symbol: "AAPL", income: "50 kr", when: "today" },
      positionsCount: 2,
    });

    expect(result).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1.284.502 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+4.120 kr (+0.32%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " MPAY paid you " },
      { kind: "value", text: "312 kr", tone: "income" },
      { kind: "text", text: " overnight." },
    ]);
    // Extra negative checks: mover and next-payout clauses are fully suppressed.
    expect(segmentsToString(result)).not.toContain("NORDA-B");
    expect(segmentsToString(result)).not.toContain("AAPL pays out");
  });

  it("2. two paydays: paydaysTotal is used, names joined with and", () => {
    const result = composeBrief({
      totalValue: "1.284.502 kr",
      todayChange: { amount: "+4.120 kr", percent: 0.32 },
      mover: null,
      paydays: [
        { symbol: "MPAY", income: "312 kr" },
        { symbol: "AAPL", income: "121 kr" },
      ],
      paydaysTotal: "433 kr",
      nextPayout: null,
      positionsCount: 2,
    });

    expect(result).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1.284.502 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+4.120 kr (+0.32%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " MPAY and AAPL paid you " },
      { kind: "value", text: "433 kr", tone: "income" },
      { kind: "text", text: " overnight." },
    ]);
  });

  it("3. mover threshold: ≥ +0.5 → rose most, ≤ −0.5 → fell most, 0.49 → quiet", () => {
    // Positive mover >= 0.5
    const resultPositive = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+100 kr", percent: 10 },
      mover: { symbol: "NORDA-B", percent: 0.5 },
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultPositive).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+100 kr (+10.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " NORDA-B rose most today." },
    ]);

    // Negative mover <= -0.5
    const resultNegative = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "-100 kr", percent: -10 },
      mover: { symbol: "NORDA-B", percent: -0.5 },
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultNegative).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "−100 kr (−10.00%)", tone: "loss" },
      { kind: "text", text: " today." },
      { kind: "text", text: " NORDA-B fell most today." },
    ]);

    // Mover at |0.49| -> quiet clause
    const resultQuiet = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+10 kr", percent: 1 },
      mover: { symbol: "NORDA-B", percent: 0.49 },
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultQuiet).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+10 kr (+1.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " No holding moved much today." },
    ]);
  });

  it("4. quiet day clause present when no payday and no significant mover", () => {
    const result = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+10 kr", percent: 1 },
      mover: null,
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });

    expect(result).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+10 kr (+1.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " No holding moved much today." },
    ]);
  });

  it("5. next payout appended after mover/quiet clause; suppressed when payday fires", () => {
    // With mover, next payout appended (when: "today")
    const resultWithMover = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+10 kr", percent: 1 },
      mover: { symbol: "NORDA-B", percent: 0.5 },
      paydays: [],
      paydaysTotal: null,
      nextPayout: { symbol: "MPAY", income: "312 kr", when: "today" },
      positionsCount: 1,
    });
    expect(resultWithMover).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+10 kr (+1.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " NORDA-B rose most today." },
      { kind: "text", text: " MPAY pays out today, around " },
      { kind: "value", text: "312 kr", tone: "income" },
      { kind: "text", text: "." },
    ]);

    // "this week" variant, appended after the quiet clause
    const resultThisWeek = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+10 kr", percent: 1 },
      mover: null,
      paydays: [],
      paydaysTotal: null,
      nextPayout: { symbol: "MPAY", income: "312 kr", when: "thisWeek" },
      positionsCount: 1,
    });
    expect(resultThisWeek).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+10 kr (+1.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " No holding moved much today." },
      { kind: "text", text: " MPAY pays out this week, around " },
      { kind: "value", text: "312 kr", tone: "income" },
      { kind: "text", text: "." },
    ]);

    // With payday, next payout suppressed
    const resultWithPayday = composeBrief({
      totalValue: "1000 kr",
      todayChange: { amount: "+10 kr", percent: 1 },
      mover: null,
      paydays: [{ symbol: "MPAY", income: "312 kr" }],
      paydaysTotal: "312 kr",
      nextPayout: { symbol: "AAPL", income: "50 kr", when: "today" },
      positionsCount: 1,
    });
    expect(resultWithPayday).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1000 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+10 kr (+1.00%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " MPAY paid you " },
      { kind: "value", text: "312 kr", tone: "income" },
      { kind: "text", text: " overnight." },
    ]);
    expect(segmentsToString(resultWithPayday)).not.toContain("AAPL pays out");
  });

  it("6. empty portfolio (positionsCount=0) → exactly welcome segment, ignoring other fields", () => {
    const result = composeBrief({
      totalValue: "0 kr",
      todayChange: { amount: "0 kr", percent: 0 },
      mover: { symbol: "NORDA-B", percent: 2.5 },
      paydays: [{ symbol: "MPAY", income: "312 kr" }],
      paydaysTotal: "312 kr",
      nextPayout: { symbol: "AAPL", income: "50 kr", when: "today" },
      positionsCount: 0,
    });

    expect(result).toEqual([
      { kind: "text", text: "Welcome to Sage. Import your transactions to get started." },
    ]);
  });

  it("7. opening always present: value with tone gain/loss based on percent, or just value if no change", () => {
    // With positive change -> gain tone
    const resultPositive = composeBrief({
      totalValue: "1.284.502 kr",
      todayChange: { amount: "+4.120 kr", percent: 0.32 },
      mover: null,
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultPositive).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1.284.502 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "+4.120 kr (+0.32%)", tone: "gain" },
      { kind: "text", text: " today." },
      { kind: "text", text: " No holding moved much today." },
    ]);

    // With negative change -> loss tone
    const resultNegative = composeBrief({
      totalValue: "1.284.502 kr",
      todayChange: { amount: "-4.120 kr", percent: -0.32 },
      mover: null,
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultNegative).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1.284.502 kr", tone: "neutral" },
      { kind: "text", text: " — " },
      { kind: "value", text: "−4.120 kr (−0.32%)", tone: "loss" },
      { kind: "text", text: " today." },
      { kind: "text", text: " No holding moved much today." },
    ]);

    // With null change -> opening is just the value and a period
    const resultNoChange = composeBrief({
      totalValue: "1.284.502 kr",
      todayChange: null,
      mover: null,
      paydays: [],
      paydaysTotal: null,
      nextPayout: null,
      positionsCount: 1,
    });
    expect(resultNoChange).toEqual([
      { kind: "text", text: "Your portfolio stands at " },
      { kind: "value", text: "1.284.502 kr", tone: "neutral" },
      { kind: "text", text: "." },
      { kind: "text", text: " No holding moved much today." },
    ]);
  });

  it("8. marketState: Sat/Sun → weekend, Mon 08:59 → preOpen, Mon 09:00 → open, Fri 21:59 → open, Fri 22:00 → closed", () => {
    // Sat -> weekend
    const sat = new Date(2026, 6, 11, 12, 0); // July 11, 2026 is a Saturday
    expect(marketState(sat)).toBe("weekend");

    // Sun -> weekend
    const sun = new Date(2026, 6, 12, 12, 0); // July 12, 2026 is a Sunday
    expect(marketState(sun)).toBe("weekend");

    // Mon 08:59 -> preOpen
    const monPreopen = new Date(2026, 6, 13, 8, 59); // July 13, 2026 is a Monday
    expect(marketState(monPreopen)).toBe("preOpen");

    // Mon 09:00 -> open
    const monOpen = new Date(2026, 6, 13, 9, 0);
    expect(marketState(monOpen)).toBe("open");

    // Fri 21:59 -> open
    const friOpen = new Date(2026, 6, 17, 21, 59); // July 17, 2026 is a Friday
    expect(marketState(friOpen)).toBe("open");

    // Fri 22:00 -> closed
    const friClosed = new Date(2026, 6, 17, 22, 0);
    expect(marketState(friClosed)).toBe("closed");
  });

  it("9. marketStateLine: open/preOpen/weekend/closed with various todayChange states", () => {
    // open
    expect(marketStateLine("open", null)).toEqual([{ kind: "text", text: "Markets are open." }]);

    // preOpen
    expect(marketStateLine("preOpen", null)).toEqual([
      { kind: "text", text: "Markets open later today." },
    ]);

    // weekend
    expect(marketStateLine("weekend", null)).toEqual([
      { kind: "text", text: "Markets are asleep. See you Monday." },
    ]);

    // closed with positive change
    expect(marketStateLine("closed", { percent: 0.5 })).toEqual([
      { kind: "text", text: "Markets closed " },
      { kind: "value", text: "green", tone: "gain" },
      { kind: "text", text: "." },
    ]);

    // closed with negative change
    expect(marketStateLine("closed", { percent: -0.5 })).toEqual([
      { kind: "text", text: "Markets closed " },
      { kind: "value", text: "red", tone: "loss" },
      { kind: "text", text: "." },
    ]);

    // closed with null change
    expect(marketStateLine("closed", null)).toEqual([
      { kind: "text", text: "Markets are closed." },
    ]);
  });
});

describe("composeColorLine", () => {
  const base = {
    totalValue: "$7,451.39",
    todayChange: { amount: "-$65.18", percent: -0.87 },
    mover: { symbol: "MSFT", percent: -1.55 },
    paydays: [],
    paydaysTotal: null,
    nextPayout: null,
    positionsCount: 3,
  };

  it("omits the portfolio value and the total day-change figure", () => {
    const text = composeColorLine(base)
      .map((s) => s.text)
      .join("");
    expect(text).not.toContain("$7,451.39");
    expect(text).not.toContain("-$65.18");
    expect(text).not.toContain("−$65.18");
    expect(text).not.toContain("0.87");
  });

  it("keeps the mover clause", () => {
    const text = composeColorLine(base)
      .map((s) => s.text)
      .join("");
    expect(text).toContain("MSFT fell most today.");
  });

  it("returns the welcome line for an empty portfolio", () => {
    const text = composeColorLine({ ...base, positionsCount: 0 })
      .map((s) => s.text)
      .join("");
    expect(text).toContain("Import your transactions");
  });
});
