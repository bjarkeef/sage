import { describe, it, expect } from "vitest";
import { Decimal } from "../money/decimal";
import { incomePaymentDates, accrueGrossIncome } from "./custom-income";

describe("incomePaymentDates", () => {
  it("walks quarterly from the first payment, capped at `until`", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2026-04-30",
        lastPaymentDate: "2041-05-01",
        unit: "quarter",
        interval: 1,
        until: "2026-07-18",
      }),
    ).toEqual(["2026-04-30"]); // next would be 2026-07-30 — after `until`
  });

  it("includes the next quarter once `until` passes it", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2026-04-30",
        lastPaymentDate: null,
        unit: "quarter",
        interval: 1,
        until: "2026-07-30",
      }),
    ).toEqual(["2026-04-30", "2026-07-30"]);
  });

  it("walks weekly (CASHPOT_GBP cadence)", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2025-12-01",
        lastPaymentDate: null,
        unit: "week",
        interval: 1,
        until: "2026-01-05",
      }),
    ).toEqual(["2025-12-01", "2025-12-08", "2025-12-15", "2025-12-22", "2025-12-29", "2026-01-05"]);
  });

  it("clamps month-end instead of rolling over", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2026-01-31",
        lastPaymentDate: null,
        unit: "month",
        interval: 1,
        until: "2026-03-31",
      }),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("respects lastPaymentDate", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2026-01-01",
        lastPaymentDate: "2026-02-01",
        unit: "month",
        interval: 1,
        until: "2026-12-31",
      }),
    ).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("throws on non-positive or non-integer interval instead of looping forever", () => {
    for (const interval of [0, -1, 1.5]) {
      expect(() =>
        incomePaymentDates({
          firstPaymentDate: "2026-01-01",
          lastPaymentDate: null,
          unit: "month",
          interval,
          until: "2026-12-31",
        }),
      ).toThrow(/interval/);
    }
  });

  it("walks yearly and multi-interval cadences", () => {
    expect(
      incomePaymentDates({
        firstPaymentDate: "2024-02-29",
        lastPaymentDate: null,
        unit: "year",
        interval: 1,
        until: "2026-12-31",
      }),
    ).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
    expect(
      incomePaymentDates({
        firstPaymentDate: "2026-01-15",
        lastPaymentDate: null,
        unit: "month",
        interval: 4,
        until: "2026-12-31",
      }),
    ).toEqual(["2026-01-15", "2026-05-15", "2026-09-15"]);
  });
});

describe("accrueGrossIncome", () => {
  // Daily accrual on the running balance: buys are effective on their trade
  // date and the window [start, end) excludes the payment date itself. That
  // end-exclusive convention is not a guess — it was settled by reconciling
  // against a real broker payment øre-for-øre, and getting it wrong shifts the
  // result by a full day's interest.
  //
  // Increments, not balances:
  //   2026-03-02  +8,000 → 8,000     14 days →  112,000 unit-days
  //   2026-03-16  +4,000 → 12,000    16 days →  192,000
  //   2026-04-01  +8,000 → 20,000    29 days →  580,000
  //   2026-04-30  +5,000 → 25,000     0 days (payment date, must NOT accrue)
  //                                          ───────────
  //                                             884,000 unit-days
  //   gross = 884,000 × 4.25 / 36,500 = 102.9315068493150684…
  const buys: [string, number][] = [
    ["2026-03-02", 8000],
    ["2026-03-16", 4000],
    ["2026-04-01", 8000],
    ["2026-04-30", 5000], // same-day as payment — must NOT accrue
  ];
  const balanceOn = (date: string): Decimal => {
    let bal = new Decimal(0);
    for (const [d, amount] of buys) {
      if (d <= date) bal = bal.plus(amount);
    }
    return bal;
  };

  it("accrues daily on the running balance, excluding the payment date", () => {
    const gross = accrueGrossIncome({
      start: "2026-03-02",
      end: "2026-04-30",
      yearlyPct: new Decimal("4.25"),
      valueOn: balanceOn,
    });
    // Full precision, not toFixed(2): the whole point of Decimal here is that
    // the øre survive, and a rounded assertion would pass on a float too.
    expect(gross.toFixed(8)).toBe("102.93150685");
    const tax = gross.times("0.35");
    expect(tax.toFixed(8)).toBe("36.02602740");
    const net = gross.minus(tax);
    expect(net.toFixed(8)).toBe("66.90547945");
    expect(net.plus(tax).toFixed(8)).toBe(gross.toFixed(8));
  });

  it("excludes the payment date rather than the start date", () => {
    // Guards the [start, end) convention specifically: including 2026-04-30
    // would add a day at the 25,000 balance (+2.9109…), and excluding
    // 2026-03-02 would drop a day at 8,000 (−0.9315…). Neither must happen.
    const gross = accrueGrossIncome({
      start: "2026-03-02",
      end: "2026-04-30",
      yearlyPct: new Decimal("4.25"),
      valueOn: balanceOn,
    });
    const withPaymentDay = accrueGrossIncome({
      start: "2026-03-02",
      end: "2026-05-01",
      yearlyPct: new Decimal("4.25"),
      valueOn: balanceOn,
    });
    expect(withPaymentDay.minus(gross).toFixed(8)).toBe("2.91095890"); // 25,000 × 4.25 / 36,500
  });

  it("returns zero for a zero-balance window", () => {
    const gross = accrueGrossIncome({
      start: "2026-01-01",
      end: "2026-02-01",
      yearlyPct: new Decimal("4.25"),
      valueOn: () => new Decimal(0),
    });
    expect(gross.isZero()).toBe(true);
  });
});
