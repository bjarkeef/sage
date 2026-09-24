import { describe, it, expect } from "vitest";
import { buildCalendarEvents } from "./dividend-events";
import type {
  RetroactiveIncomeRowDTO,
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  LongRangeIncomeRowDTO,
} from "./types";

// Fixed, explicitly-passed "today". Never `new Date()` — a fixture that reads
// the real clock rots into a red build the day the window moves past it.
const TODAY = "2026-08-23";

function retro(over: Partial<RetroactiveIncomeRowDTO> = {}): RetroactiveIncomeRowDTO {
  return {
    symbol: "AAPL",
    name: "Apple Inc",
    exDate: "2026-08-10",
    paymentDate: "2026-08-14",
    paymentDateEstimated: false,
    amountPerShare: "0.18",
    sharesHeld: "22.5",
    income: "4.05",
    currency: "USD",
    ...over,
  };
}

describe("buildCalendarEvents", () => {
  it("keys events by payment date, falling back to ex-date", () => {
    const map = buildCalendarEvents([retro()], [], [], TODAY);
    expect([...map.keys()]).toEqual(["2026-08-14"]);

    const noPay = buildCalendarEvents([retro({ paymentDate: null })], [], [], TODAY);
    expect([...noPay.keys()]).toEqual(["2026-08-10"]);
  });

  it("marks a retroactive row still in flight as announced, not paid", () => {
    // The row is historical data, but its money has not landed yet. Calling it
    // "paid" would colour an unreceived payment as received.
    const map = buildCalendarEvents([retro({ paymentDate: "2026-09-14" })], [], [], TODAY);
    expect(map.get("2026-09-14")![0]!.type).toBe("announced");

    const past = buildCalendarEvents([retro({ paymentDate: "2026-08-14" })], [], [], TODAY);
    expect(past.get("2026-08-14")![0]!.type).toBe("paid");
  });

  it("collects several payments landing on one date", () => {
    const map = buildCalendarEvents(
      [retro(), retro({ symbol: "MSFT", name: "Microsoft Corporation", income: "2.73" })],
      [],
      [],
      TODAY,
    );
    expect(map.get("2026-08-14")).toHaveLength(2);
  });

  it("carries announced and projected rows through with their own types", () => {
    const announced: AnnouncedDividendDTO = {
      symbol: "O",
      name: "Realty Income Corporation",
      exDate: "2026-08-31",
      paymentDate: "2026-09-15",
      paymentDateEstimated: false,
      declarationDate: "2026-08-12",
      recordDate: "2026-09-01",
      amountPerShare: "0.271",
      shares: "20",
      income: "5.42",
      currency: "USD",
    };
    const projected: ProjectedIncomeRowDTO = {
      symbol: "O",
      name: "Realty Income Corporation",
      projectedExDate: "2026-09-30",
      paymentDate: "2026-10-16",
      paymentDateEstimated: true,
      amountPerShare: "0.271",
      shares: "20",
      income: "5.42",
      currency: "USD",
      confidence: "high",
    };

    const map = buildCalendarEvents([], [announced], [projected], TODAY);
    expect(map.get("2026-09-15")![0]!.type).toBe("announced");
    expect(map.get("2026-10-16")![0]!.type).toBe("projected");
  });

  it("brings long-range rows in as projected events that say so", () => {
    const projected: ProjectedIncomeRowDTO = {
      symbol: "O",
      name: "Realty Income Corporation",
      projectedExDate: "2026-09-30",
      paymentDate: "2026-10-16",
      paymentDateEstimated: true,
      amountPerShare: "0.271",
      shares: "20",
      income: "5.42",
      currency: "USD",
      confidence: "high",
    };
    const longRange: LongRangeIncomeRowDTO = {
      ...projected,
      projectedExDate: "2028-09-29",
      paymentDate: "2028-10-16",
      income: "5.88",
      growthPct: 4.2,
    };

    const map = buildCalendarEvents([], [], [projected], TODAY, [longRange]);
    const near = map.get("2026-10-16")![0]!;
    const far = map.get("2028-10-16")![0]!;
    expect(near.longRange).toBeUndefined();
    expect(far).toMatchObject({
      type: "projected",
      longRange: true,
      growthPct: 4.2,
      income: "5.88",
    });
  });
});
