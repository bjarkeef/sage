import { describe, it, expect } from "vitest";
import { Decimal, type DividendHistoryRow, type ProjectedDividendRow } from "@sage/core";
import {
  forwardGrowth,
  forwardScheduleForSymbol,
  toAssetUpcoming,
  type ForwardSchedule,
} from "./forward-schedule";

// Injected "today". Every date below is built relative to it; nothing here
// reads the real clock.
const NOW = new Date("2026-06-15T12:00:00Z");
const TODAY = NOW.toISOString().slice(0, 10);

function day(offset: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function div(
  exDate: string,
  amount = "0.50",
  extra: Partial<DividendHistoryRow> = {},
): DividendHistoryRow {
  return {
    symbol: "KO",
    exDate,
    amountPerShare: amount,
    currency: "USD",
    paymentDate: null,
    paymentDateEstimated: false,
    period: null,
    ...extra,
  };
}

/** Eight quarterly payments, the last one 91 days ago. */
const QUARTERLY = Array.from({ length: 8 }, (_, i) => {
  const ex = day(-91 * (8 - i));
  return div(ex, "0.50", { paymentDate: day(-91 * (8 - i) + 14) });
});

function scheduled(
  kind: "announced" | "projected",
  exDate: string,
  amount = "0.50",
): ProjectedDividendRow {
  return {
    symbol: "KO",
    kind,
    confidence: "high",
    exDate,
    paymentDate: day(Math.round((Date.parse(exDate) - Date.parse(TODAY)) / 86_400_000) + 14),
    paymentDateEstimated: kind === "projected",
    amountPerShare: amount,
    shares: "1",
    income: amount,
    currency: "USD",
  };
}

describe("forwardScheduleForSymbol", () => {
  it("keeps the 12-month schedule inside (today, today + 1 year]", () => {
    const s = forwardScheduleForSymbol({
      symbol: "KO",
      quantity: new Decimal(1),
      history: QUARTERLY,
      now: NOW,
      growth: null,
    });
    const twelve = [...s.announced, ...s.projected];
    expect(twelve.length).toBeGreaterThan(0);
    for (const r of twelve) {
      expect(r.exDate > TODAY).toBe(true);
      expect(r.exDate <= day(365)).toBe(true);
    }
  });

  it("counts a payment in the next 12 months by when the cash lands, not by its ex-date", () => {
    // A monthly payer paying 21 days after ex: its twelfth ex-date in the year
    // pays after the year is out. Counting by ex-date (plus the payments in
    // flight, which the income view adds) put 13 months of cash in "the next 12
    // months". That payment belongs to the calendar's long range instead.
    const monthly = Array.from({ length: 6 }, (_, i) =>
      div(day(-30 * (6 - i) + 10), "0.20", {
        paymentDate: day(-30 * (6 - i) + 31),
        period: "Monthly",
      }),
    );
    const s = forwardScheduleForSymbol({
      symbol: "KO",
      quantity: new Decimal(1),
      history: monthly,
      now: NOW,
      growth: null,
    });
    const cash = (r: ProjectedDividendRow) => r.paymentDate ?? r.exDate;
    const twelve = [...s.announced, ...s.projected];
    expect(twelve.every((r) => cash(r) <= day(365))).toBe(true);
    // Moved, not dropped: the late-paying one is the long range's first payment.
    const late = s.longRange.filter((r) => r.exDate <= day(365));
    expect(late).toHaveLength(1);
    expect(cash(late[0]!) > day(365)).toBe(true);
    expect(s.longRange.every((r) => cash(r) > day(365))).toBe(true);
  });

  it("treats a future-dated history row as announced and never projects a second payment beside it", () => {
    const s = forwardScheduleForSymbol({
      symbol: "KO",
      quantity: new Decimal(1),
      history: [...QUARTERLY, div(day(30), "0.52", { paymentDate: day(44) })],
      now: NOW,
      growth: null,
    });
    expect(s.announced.map((r) => [r.exDate, r.amountPerShare])).toEqual([[day(30), "0.52"]]);
    for (const p of s.projected) {
      expect(
        Math.abs(Date.parse(p.exDate) - Date.parse(day(30))) / 86_400_000,
      ).toBeGreaterThanOrEqual(14);
    }
  });

  it("ignores other symbols' rows", () => {
    const other = QUARTERLY.map((d) => ({ ...d, symbol: "PG", amountPerShare: "9.99" }));
    const s = forwardScheduleForSymbol({
      symbol: "KO",
      quantity: new Decimal(1),
      history: [...QUARTERLY, ...other],
      now: NOW,
      growth: null,
    });
    for (const r of [...s.announced, ...s.projected, ...s.longRange])
      expect(r.amountPerShare).not.toBe("9.99");
  });

  it("runs the long range from past the 12-month horizon to 31 December three years out, grown", () => {
    const s = forwardScheduleForSymbol({
      symbol: "KO",
      quantity: new Decimal(1),
      history: QUARTERLY,
      now: NOW,
      growth: new Decimal("0.1"),
    });
    expect(s.longRange.length).toBeGreaterThan(0);
    const through = `${NOW.getUTCFullYear() + 3}-12-31`;
    for (const r of s.longRange) {
      expect(r.exDate > day(365)).toBe(true);
      expect(r.exDate <= through).toBe(true);
      // The first year is never grown, so everything past it is above 0.50.
      expect(Number(r.amountPerShare)).toBeGreaterThan(0.5);
    }
  });
});

describe("toAssetUpcoming", () => {
  const schedule: ForwardSchedule = {
    announced: [scheduled("announced", day(20))],
    projected: [scheduled("projected", day(111))],
    longRange: [scheduled("projected", day(400)), scheduled("announced", day(380))],
  };

  it("names certainty by kind and the window each row counts toward", () => {
    const rows = toAssetUpcoming({ schedule, history: [], todayIso: TODAY });
    expect(rows.map((r) => [r.exDate, r.certainty, r.window])).toEqual([
      [day(20), "confirmed", "next12m"],
      [day(111), "estimated", "next12m"],
      [day(380), "confirmed", "longRange"],
      [day(400), "estimated", "longRange"],
    ]);
  });

  it("counts a payment in flight — ex-date passed, cash still to come — as confirmed in the next 12 months", () => {
    const rows = toAssetUpcoming({
      schedule: { announced: [], projected: [], longRange: [] },
      history: [
        div(day(-5), "0.50", { paymentDate: day(10) }), // in flight
        div(day(-40), "0.50", { paymentDate: day(-26) }), // already paid
        div(day(-3), "0.50", { paymentDate: null }), // no payment date: cannot be in flight
      ],
      todayIso: TODAY,
    });
    expect(rows).toEqual([
      {
        exDate: day(-5),
        paymentDate: day(10),
        amountPerShare: "0.50",
        currency: "USD",
        certainty: "confirmed",
        window: "next12m",
      },
    ]);
  });

  it("sorts by cash date across sources, not within each", () => {
    const rows = toAssetUpcoming({
      schedule,
      history: [div(day(-5), "0.50", { paymentDate: day(2) })],
      todayIso: TODAY,
    });
    const cash = rows.map((r) => r.paymentDate ?? r.exDate);
    expect(cash).toEqual([...cash].sort());
  });
});

describe("forwardGrowth", () => {
  it("has no growth when there is no historical rate", () => {
    expect(forwardGrowth(null, true)).toEqual({ growth: null, cappedFrom: null });
  });

  it("passes a rate under the cap through and says nothing was capped", () => {
    const { growth, cappedFrom } = forwardGrowth(new Decimal("0.05"), true);
    expect(growth!.toString()).toBe("0.05");
    expect(cappedFrom).toBeNull();
  });

  it("caps at 10% and keeps the historical rate it was capped from", () => {
    const { growth, cappedFrom } = forwardGrowth(new Decimal("0.25"), true);
    expect(growth!.toString()).toBe("0.1");
    expect(cappedFrom!.toString()).toBe("0.25");
  });

  it("floors a decline at zero only when negative growth is off, and that is not a cap", () => {
    expect(forwardGrowth(new Decimal("-0.04"), true).growth!.toString()).toBe("-0.04");
    const off = forwardGrowth(new Decimal("-0.04"), false);
    expect(off.growth!.toString()).toBe("0");
    expect(off.cappedFrom).toBeNull();
  });
});
