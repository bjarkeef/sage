import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { Money } from "@sage/core";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import {
  planDividendReconciliation,
  syncDividends,
  planPaymentDateEstimates,
  type StoredDividendRow,
} from "./dividend-sync";
import { describeDb, withTestDb, type TestDb } from "../testing";
import { dividendHistory, instrument } from "../db/schema";

function row(
  exDate: string,
  amountPerShare: string,
  currency = "USD",
  paymentDate: string | null = null,
): StoredDividendRow {
  return {
    exDate,
    amountPerShare,
    currency,
    paymentDate,
    paymentDateEstimated: false,
    recordDate: null,
    declarationDate: null,
    period: null,
  };
}

describe("planDividendReconciliation", () => {
  it("upserts every incoming row and deletes nothing when the HUDSON is empty and the feed is clean", () => {
    const incoming = [row("2025-03-10", "0.24"), row("2025-06-10", "0.25")];

    const { upserts, deleteExDates } = planDividendReconciliation("AAPL", [], incoming);

    expect(upserts.map((r) => r.exDate)).toEqual(["2025-03-10", "2025-06-10"]);
    expect(deleteExDates).toEqual([]);
  });

  it("collapses a near-duplicate within the incoming feed, keeping the later ex-date", () => {
    const incoming = [row("2026-05-29", "0.86917"), row("2026-06-01", "0.8736")];

    const { upserts, deleteExDates } = planDividendReconciliation("HUDSON", [], incoming);

    expect(upserts.map((r) => r.exDate)).toEqual(["2026-06-01"]);
    expect(upserts[0]!.amountPerShare).toBe("0.8736");
    expect(deleteExDates).toEqual([]);
  });

  it("deletes a stored near-duplicate that the fresh feed reports a few days later", () => {
    const existing = [row("2026-05-29", "0.86917", "USD", "2026-06-15")];
    const incoming = [row("2026-06-01", "0.8736")];

    const { upserts, deleteExDates } = planDividendReconciliation("HUDSON", existing, incoming);

    expect(upserts.map((r) => r.exDate)).toEqual(["2026-06-01"]);
    expect(deleteExDates).toEqual(["2026-05-29"]);
  });

  it("keeps legitimately distinct dividends and refreshes them all", () => {
    const existing = [row("2025-06-10", "0.25")];
    const incoming = [row("2025-06-10", "0.25"), row("2025-09-10", "0.26")];

    const { upserts, deleteExDates } = planDividendReconciliation("AAPL", existing, incoming);

    expect(upserts.map((r) => r.exDate)).toEqual(["2025-06-10", "2025-09-10"]);
    expect(deleteExDates).toEqual([]);
  });

  it("preserves stored history the feed no longer returns", () => {
    const existing = [row("2020-01-15", "0.18"), row("2025-06-10", "0.25")];
    const incoming = [row("2025-06-10", "0.25")];

    const { upserts, deleteExDates } = planDividendReconciliation("AAPL", existing, incoming);

    expect(upserts.map((r) => r.exDate)).toEqual(["2025-06-10"]);
    expect(deleteExDates).toEqual([]);
  });
});

describe("planDividendReconciliation field merging", () => {
  const base = { amountPerShare: "0.27", currency: "USD" };

  it("a null-bearing sync never clobbers a stored payment date", () => {
    const existing = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: "2026-07-15",
        paymentDateEstimated: false,
        recordDate: "2026-06-30",
        declarationDate: "2026-06-09",
        period: "Monthly",
      },
    ];
    const incoming = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: null,
        paymentDateEstimated: false,
        recordDate: null,
        declarationDate: null,
        period: null,
      },
    ];
    const { upserts } = planDividendReconciliation("O", existing, incoming);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      paymentDate: "2026-07-15",
      paymentDateEstimated: false,
      recordDate: "2026-06-30",
      declarationDate: "2026-06-09",
      period: "Monthly",
    });
  });

  it("a real payment date replaces an estimated one and clears the flag", () => {
    const existing = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: "2026-07-21",
        paymentDateEstimated: true,
        recordDate: null,
        declarationDate: null,
        period: null,
      },
    ];
    const incoming = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: "2026-07-15",
        paymentDateEstimated: false,
        recordDate: null,
        declarationDate: null,
        period: null,
      },
    ];
    const { upserts } = planDividendReconciliation("O", existing, incoming);
    expect(upserts[0]).toMatchObject({ paymentDate: "2026-07-15", paymentDateEstimated: false });
  });

  it("an incoming null payment date keeps a stored estimate flagged as estimated", () => {
    const existing = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: "2026-07-21",
        paymentDateEstimated: true,
        recordDate: null,
        declarationDate: null,
        period: null,
      },
    ];
    const incoming = [
      {
        exDate: "2026-06-30",
        ...base,
        paymentDate: null,
        paymentDateEstimated: false,
        recordDate: null,
        declarationDate: null,
        period: null,
      },
    ];
    const { upserts } = planDividendReconciliation("O", existing, incoming);
    expect(upserts[0]).toMatchObject({ paymentDate: "2026-07-21", paymentDateEstimated: true });
  });
});

describe("planPaymentDateEstimates", () => {
  const rowHelper = (
    exDate: string,
    paymentDate: string | null,
    estimated = false,
  ): StoredDividendRow => ({
    exDate,
    amountPerShare: "0.25",
    currency: "USD",
    paymentDate,
    paymentDateEstimated: estimated,
    recordDate: null,
    declarationDate: null,
    period: null,
  });

  it("estimates missing payment dates using the symbol's median lag", () => {
    const rows = [
      rowHelper("2026-01-30", "2026-02-13"), // lag 14
      rowHelper("2026-02-27", "2026-03-13"), // lag 14
      rowHelper("2026-03-31", "2026-04-15"), // lag 15
      rowHelper("2026-04-30", null),
    ];
    expect(planPaymentDateEstimates(rows)).toEqual([
      { exDate: "2026-04-30", paymentDate: "2026-05-14" }, // ex + 14 (median)
    ]);
  });

  it("falls back to a 21-day default lag when no real payment dates exist", () => {
    const rows = [rowHelper("2026-04-30", null)];
    expect(planPaymentDateEstimates(rows)).toEqual([
      { exDate: "2026-04-30", paymentDate: "2026-05-21" },
    ]);
  });

  it("re-derives previously estimated dates but never touches real ones", () => {
    const rows = [
      rowHelper("2026-01-30", "2026-02-13"),
      rowHelper("2026-02-27", "2026-03-20", true), // stale estimate -> re-derived to +14
    ];
    expect(planPaymentDateEstimates(rows)).toEqual([
      { exDate: "2026-02-27", paymentDate: "2026-03-13" },
    ]);
  });
});

describeDb("syncDividends (integration)", () => {
  let tdb: TestDb;

  beforeAll(async () => {
    tdb = await withTestDb();
    await tdb.db.insert(instrument).values({
      symbol: "HUDSON",
      name: "Hudson Bancorp",
      exchange: "XETRA",
      currency: "EUR",
      assetType: "stock",
    });
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it("removes a stored near-duplicate when the feed reports the same payment a few days later", async () => {
    // A stale annual dividend already in the table.
    await tdb.db.insert(dividendHistory).values({
      symbol: "HUDSON",
      exDate: "2026-05-29",
      amountPerShare: "0.86917",
      currency: "EUR",
      source: "test",
    });

    const provider = new FakeMarketDataProvider({
      dividends: {
        HUDSON: [
          {
            symbol: "HUDSON",
            amountPerShare: Money.of("0.8736", "EUR"),
            exDividendDate: new Date("2026-06-01T00:00:00Z"),
            paymentDate: null,
            announcedDate: null,
            recordDate: null,
            period: null,
          },
        ],
      },
    });

    const written = await syncDividends(tdb.db, [provider], "HUDSON");
    expect(written).toBe(1);

    const stored = await tdb.db
      .select()
      .from(dividendHistory)
      .where(eq(dividendHistory.symbol, "HUDSON"));

    expect(stored).toHaveLength(1);
    expect(stored[0]!.exDate).toBe("2026-06-01");
    expect(stored[0]!.amountPerShare).toBe("0.8736");

    // The provider left paymentDate null and the symbol has no provider-sourced
    // payment dates, so the sync estimates ex-date + 21 days (default lag) and
    // flags the row as estimated.
    expect(stored[0]!.paymentDate).toBe("2026-06-22");
    expect(stored[0]!.paymentDateEstimated).toBe(true);

    // The stale row is gone.
    const stale = await tdb.db
      .select()
      .from(dividendHistory)
      .where(and(eq(dividendHistory.symbol, "HUDSON"), eq(dividendHistory.exDate, "2026-05-29")));
    expect(stale).toHaveLength(0);
  }, 30_000);
});
