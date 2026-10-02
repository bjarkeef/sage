import { describe, it, expect } from "vitest";
import {
  analystUpside,
  currentYield,
  holdingWeight,
  nextPayment,
  nextTwelveMonths,
  payFrequencyOf,
  rangePlace,
  RANGE_PLACE_PHRASE,
  REASONS,
} from "./figures";
import {
  TODAY,
  assetDetail,
  bookPositions,
  quarterlyHistory,
  upcomingRow,
  usd,
} from "../test/asset-fixtures";

describe("nextTwelveMonths", () => {
  it("sums only the next-12-months window, for the shares held — gross", () => {
    expect(nextTwelveMonths(assetDetail().upcoming, 100)).toEqual({
      ok: true,
      value: { amount: "200.000000", currency: "USD" },
    });
  });

  it("is the per-share figure at quantity 1", () => {
    const r = nextTwelveMonths(assetDetail().upcoming, 1);
    expect(r.ok && Number(r.value.amount)).toBe(2);
  });

  it("says why instead of reading zero", () => {
    expect(nextTwelveMonths([], 100)).toEqual({ ok: false, reason: REASONS.noneExpected });
    expect(nextTwelveMonths([upcomingRow(10), upcomingRow(100, { currency: "EUR" })], 1)).toEqual({
      ok: false,
      reason: REASONS.mixedCurrency,
    });
  });
});

describe("nextPayment", () => {
  it("is the first payment whose cash date is after today", () => {
    const rows = [upcomingRow(-20, { paymentDate: TODAY }), upcomingRow(61), upcomingRow(5)];
    expect(nextPayment(rows, TODAY)?.exDate).toBe(upcomingRow(5).exDate);
  });

  it("is null with nothing ahead", () => {
    expect(nextPayment([], TODAY)).toBeNull();
  });
});

describe("payFrequencyOf", () => {
  it("reads the rhythm from the busier of the last and the next 12 months", () => {
    expect(payFrequencyOf(quarterlyHistory(), [], TODAY)).toBe("pays quarterly");
    expect(payFrequencyOf([], assetDetail().upcoming, TODAY)).toBe("pays quarterly");
    expect(payFrequencyOf([], [], TODAY)).toBeNull();
  });
});

describe("currentYield", () => {
  it("is the endpoint's TTM ÷ live price", () => {
    expect(currentYield(assetDetail())).toEqual({ ok: true, value: 0.033333 });
  });

  it("names the reason it is missing", () => {
    const d = assetDetail();
    expect(
      currentYield({ ...d, quote: null, income: { ...d.income, currentYield: null } }),
    ).toEqual({
      ok: false,
      reason: REASONS.noQuote,
    });
    expect(
      currentYield({ ...d, income: { ...d.income, currentYield: null, annualDividend: null } }),
    ).toEqual({ ok: false, reason: REASONS.noDividends });
    expect(currentYield({ ...d, income: { ...d.income, currentYield: null } })).toEqual({
      ok: false,
      reason: REASONS.mixedCurrency,
    });
  });
});

describe("analystUpside — the consistency check that it uses the HEADER price", () => {
  it("measures the mean target against the quote, whatever the provider's currentPrice says", () => {
    // ratings().currentPrice is 64 in the fixtures; from it the upside would be 3.1%.
    const r = analystUpside(usd("66"), assetDetail().quote);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.abs).toBeCloseTo(6, 10);
      expect(r.value.pct).toBeCloseTo(10, 10);
      expect(r.value.currency).toBe("USD");
    }
  });

  it("refuses to compare across currencies or without a price", () => {
    expect(analystUpside({ amount: "66", currency: "EUR" }, assetDetail().quote).ok).toBe(false);
    expect(analystUpside(usd("66"), null)).toEqual({ ok: false, reason: REASONS.noQuote });
    expect(analystUpside(null, assetDetail().quote)).toEqual({
      ok: false,
      reason: REASONS.providerNone,
    });
  });
});

describe("holdingWeight", () => {
  it("is this holding's share of the book's market value", () => {
    const w = holdingWeight(bookPositions(), "KO");
    expect(w.ok && w.value).toBeCloseTo(0.08, 10);
  });

  it("says why when it can't be measured", () => {
    expect(holdingWeight(undefined, "KO")).toEqual({ ok: false, reason: REASONS.noBook });
    expect(holdingWeight(bookPositions(), "MSFT")).toEqual({ ok: false, reason: REASONS.notHeld });
    const noPrice = bookPositions().map((p) =>
      p.symbol === "KO" ? { ...p, marketValue: null } : p,
    );
    expect(holdingWeight(noPrice, "KO")).toEqual({ ok: false, reason: REASONS.noQuote });
  });

  it("is '—' rather than a sum across currencies when the book's values are in more than one", () => {
    // No display currency set: /portfolio sends each holding in its own currency.
    const mixed = bookPositions().map((p) =>
      p.symbol === "O"
        ? { ...p, currency: "EUR", marketValue: { amount: "69000", currency: "EUR" } }
        : p,
    );
    expect(holdingWeight(mixed, "KO")).toEqual({ ok: false, reason: REASONS.mixedBookCurrency });
    expect(REASONS.mixedBookCurrency).toBe(
      "Set a display currency to compare holdings in different currencies",
    );
  });

  it("ignores an unpriced holding's currency — it adds nothing to the total either way", () => {
    const unpricedForeign = bookPositions().map((p) =>
      p.symbol === "O" ? { ...p, currency: "EUR", marketValue: null } : p,
    );
    const w = holdingWeight(unpricedForeign, "KO");
    expect(w.ok && w.value).toBeCloseTo(1, 10);
  });
});

describe("rangePlace", () => {
  it("places today in thirds of the range, and outside it when it is", () => {
    expect(rangePlace(0.02, 0.05, 0.021)).toBe("low");
    expect(rangePlace(0.02, 0.05, 0.033)).toBe("middle");
    expect(rangePlace(0.02, 0.05, 0.049)).toBe("high");
    expect(rangePlace(0.02, 0.05, 0.06)).toBe("above");
    expect(rangePlace(0.02, 0.05, 0.01)).toBe("below");
    expect(rangePlace(0.03, 0.03, 0.03)).toBe("middle");
    expect(RANGE_PLACE_PHRASE.high).toBe("high of its 5-yr range");
  });
});
