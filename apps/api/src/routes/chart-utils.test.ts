import { describe, it, expect } from "vitest";
import { forwardFillChart, type ChartPoint } from "./chart-utils";

const usd = (amount: string) => ({ amount, currency: "USD" });

describe("forwardFillChart", () => {
  it("returns empty array for empty input", () => {
    expect(forwardFillChart([])).toEqual([]);
  });

  it("returns single point unchanged", () => {
    const points: ChartPoint[] = [{ date: "2025-06-02", close: usd("100") }];
    expect(forwardFillChart(points)).toEqual(points);
  });

  it("leaves consecutive weekdays unchanged", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-02", close: usd("100") }, // Mon
      { date: "2025-06-03", close: usd("101") }, // Tue
      { date: "2025-06-04", close: usd("102") }, // Wed
    ];
    expect(forwardFillChart(points)).toEqual(points);
  });

  it("fills a single missing weekday", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-02", close: usd("100") }, // Mon
      // Tue missing
      { date: "2025-06-04", close: usd("102") }, // Wed
    ];
    const filled = forwardFillChart(points);
    expect(filled).toHaveLength(3);
    expect(filled[1]).toEqual({ date: "2025-06-03", close: usd("100") });
  });

  it("fills multiple missing weekdays", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-02", close: usd("100") }, // Mon
      // Tue, Wed, Thu missing
      { date: "2025-06-06", close: usd("105") }, // Fri
    ];
    const filled = forwardFillChart(points);
    expect(filled).toHaveLength(5);
    expect(filled[1]!.date).toBe("2025-06-03");
    expect(filled[1]!.close).toEqual(usd("100"));
    expect(filled[2]!.date).toBe("2025-06-04");
    expect(filled[3]!.date).toBe("2025-06-05");
  });

  it("skips weekends (does not fill Saturday/Sunday)", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-06", close: usd("100") }, // Fri
      { date: "2025-06-09", close: usd("101") }, // Mon
    ];
    const filled = forwardFillChart(points);
    expect(filled).toHaveLength(2); // no Sat/Sun inserted
  });

  it("fills across a weekend gap (Fri → Tue)", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-06", close: usd("100") }, // Fri
      // Sat, Sun skipped, Mon missing
      { date: "2025-06-10", close: usd("102") }, // Tue
    ];
    const filled = forwardFillChart(points);
    expect(filled).toHaveLength(3); // Fri, Mon(filled), Tue
    expect(filled[1]).toEqual({ date: "2025-06-09", close: usd("100") });
  });

  it("filters out zero-close bars before filling", () => {
    const points: ChartPoint[] = [
      { date: "2025-06-02", close: usd("100") }, // Mon
      { date: "2025-06-03", close: usd("0") }, // Tue — zero, should be removed
      { date: "2025-06-04", close: usd("102") }, // Wed
    ];
    const filled = forwardFillChart(points);
    expect(filled).toHaveLength(3); // Mon, Tue(filled from Mon), Wed
    expect(filled[1]).toEqual({ date: "2025-06-03", close: usd("100") });
  });
});
