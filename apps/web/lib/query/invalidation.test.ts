import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateFor } from "./invalidation";

describe("invalidateFor", () => {
  it("transaction mutations invalidate all portfolio-derived families", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    await invalidateFor(qc, "transaction");
    const invalidated = spy.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    for (const key of [
      "dashboard",
      "portfolio",
      "performance",
      "dividend-income",
      "diversification",
      "transactions",
      "asset-detail",
    ]) {
      expect(invalidated).toContain(key);
    }
  });

  it("currency changes invalidate only currency-keyed families + settings", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    await invalidateFor(qc, "currency");
    const invalidated = spy.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(invalidated.sort()).toEqual(
      [
        "dashboard",
        "diversification",
        "portfolio-history",
        "user-settings",
        "categories",
        // The System card reports the pairs the book converts, which the
        // display currency defines outright.
        "system-status",
        // Goal refuses a multi-currency book with no display currency.
        "goal",
      ].sort(),
    );
  });

  it("dividend tax rate changes invalidate settings and dividend income", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    await invalidateFor(qc, "dividend-tax-rate");
    const invalidated = spy.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(invalidated.sort()).toEqual(["dividend-income", "user-settings"].sort());
  });

  it("invalidates categories on categories mutation", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await invalidateFor(qc, "categories");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["categories"] });
  });

  /** The degraded-prices banner reads `system-status`, whose `pricesMissing`
   *  counts held symbols with no stored price. An import creates instruments
   *  before their first price lands, so a status cached across that moment made
   *  "Prices are unavailable" sit above rows quoting live prices for a minute. */
  it.each(["transaction", "holdings", "import"] as const)(
    "invalidates system-status on a %s mutation, so the degraded-prices banner re-reads",
    async (mutation) => {
      const qc = new QueryClient();
      const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
      await invalidateFor(qc, mutation);
      expect(spy.mock.calls.map((c) => c[0]?.queryKey?.[0])).toContain("system-status");
    },
  );

  it("invalidates categories on portfolio-wide and currency mutations", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await invalidateFor(qc, "transaction");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["categories"] });
    spy.mockClear();
    await invalidateFor(qc, "currency");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["categories"] });
  });
});
