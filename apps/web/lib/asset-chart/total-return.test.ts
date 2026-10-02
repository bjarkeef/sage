import { describe, it, expect } from "vitest";
import { totalReturnSeries } from "./total-return";

const closes = [
  { date: "2026-03-02", close: 100 },
  { date: "2026-03-03", close: 100 },
  { date: "2026-03-04", close: 98 },
  { date: "2026-03-05", close: 99 },
];

describe("totalReturnSeries", () => {
  it("equals the price line when no dividend falls in the range", () => {
    expect(totalReturnSeries(closes, [])).toEqual(
      closes.map((c) => ({ time: c.date, value: c.close })),
    );
  });

  it("reinvests a dividend at its ex-date close: tr[i] = tr[i−1] × (close[i] + div[i]) / close[i−1]", () => {
    // The price drops 100 → 98 as a 2.00 dividend detaches: the holder is flat.
    const tr = totalReturnSeries(closes, [{ exDate: "2026-03-04", amount: 2 }]);
    expect(tr[2]!.value).toBeCloseTo(100, 10);
    expect(tr[3]!.value).toBeCloseTo((100 * 99) / 98, 10);
  });

  it("lands a dividend whose ex-date has no bar on the next bar", () => {
    const gappy = [
      { date: "2026-03-02", close: 100 },
      { date: "2026-03-04", close: 98 },
    ];
    const tr = totalReturnSeries(gappy, [{ exDate: "2026-03-03", amount: 2 }]);
    expect(tr[1]!.value).toBeCloseTo(100, 10);
  });

  it("ignores a dividend on the first day: there is no earlier close to reinvest from", () => {
    expect(totalReturnSeries(closes, [{ exDate: "2026-03-02", amount: 5 }])).toEqual(
      closes.map((c) => ({ time: c.date, value: c.close })),
    );
  });

  it("ignores a dividend after the last bar", () => {
    expect(totalReturnSeries(closes, [{ exDate: "2026-03-09", amount: 5 }]).at(-1)!.value).toBe(99);
  });

  it("returns nothing for no closes", () => {
    expect(totalReturnSeries([], [{ exDate: "2026-03-04", amount: 2 }])).toEqual([]);
  });
});
