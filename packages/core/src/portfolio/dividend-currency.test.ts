import { describe, it, expect } from "vitest";
import { inferDividendCurrency } from "./dividend-currency";

// A EUR-listed ETF that distributes in USD. The provider reports the fund's USD
// amount but labels it with the listing's currency; the broker books the same
// number in USD. Invented figures.
const provider = (
  exDate: string,
  paymentDate: string | null,
  amount: string,
  currency = "EUR",
) => ({
  exDate,
  paymentDate,
  amountPerShare: amount,
  currency,
});
const booked = (date: string, price: string, currency = "USD") => ({
  tradeDate: date,
  price,
  currency,
});

describe("inferDividendCurrency", () => {
  it("relabels when the broker booked the same per-share number in another currency", () => {
    expect(
      inferDividendCurrency(
        [
          provider("2024-02-05", "2024-02-26", "0.052471"),
          provider("2024-03-04", "2024-03-25", "0.052216"),
        ],
        [booked("2024-02-05", "0.05247"), booked("2024-03-04", "0.05222")],
      ),
    ).toBe("USD");
  });

  it("matches a booking dated at the payment rather than the ex-date", () => {
    expect(
      inferDividendCurrency(
        [
          provider("2024-02-05", "2024-02-26", "0.052471"),
          provider("2024-03-04", "2024-03-25", "0.052216"),
        ],
        [booked("2024-02-26", "0.05247"), booked("2024-03-25", "0.05222")],
      ),
    ).toBe("USD");
  });

  it("keeps the label when the provider converted — the numbers differ by an exchange rate", () => {
    expect(
      inferDividendCurrency(
        [
          provider("2024-05-13", "2024-06-03", "0.18000"),
          provider("2024-08-12", "2024-09-02", "0.24000"),
        ],
        [booked("2024-05-13", "0.20700"), booked("2024-08-12", "0.27600")],
      ),
    ).toBeNull();
  });

  it("needs two matching payments; one coincidence is not evidence", () => {
    expect(
      inferDividendCurrency(
        [provider("2024-03-04", "2024-03-25", "0.052216")],
        [booked("2024-03-04", "0.05222")],
      ),
    ).toBeNull();
  });

  it("says nothing when the broker booked the provider's own currency", () => {
    expect(
      inferDividendCurrency(
        [provider("2024-02-05", null, "0.04"), provider("2024-03-04", null, "0.04")],
        [booked("2024-02-05", "0.04", "EUR"), booked("2024-03-04", "0.04", "EUR")],
      ),
    ).toBeNull();
  });

  it("ignores bookings with no provider payment within 12 days", () => {
    expect(
      inferDividendCurrency(
        [provider("2026-01-15", null, "0.04"), provider("2026-04-15", null, "0.04")],
        [booked("2026-02-20", "0.04"), booked("2026-05-20", "0.04")],
      ),
    ).toBeNull();
  });

  it("lets conversions outvote a coincidental match", () => {
    expect(
      inferDividendCurrency(
        [
          provider("2024-05-13", null, "0.20"),
          provider("2024-08-12", null, "0.25"),
          provider("2024-11-11", null, "0.30"),
          provider("2025-02-10", null, "0.35"),
        ],
        [
          booked("2024-05-13", "0.20"),
          booked("2024-08-12", "0.25"),
          booked("2024-11-11", "0.345"),
          booked("2025-02-10", "0.402"),
        ],
      ),
    ).toBeNull();
  });
});
