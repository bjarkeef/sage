import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "./test/render-with-client";
import { qk } from "./query/keys";
import { useDividendTaxRate, useNetDividendIncome } from "./dividend-tax-hooks";
import type { DividendIncomeDTO, UserSettingsDTO } from "./types";

// Only the "still loading" test below exercises the real queryFn (no seeded
// cache data to serve from); it must never resolve so the network never gets
// hit and the test observes a stable in-flight state.
vi.mock("./api", () => ({
  getUserSettings: vi.fn(() => new Promise(() => {})),
  getDividendIncome: vi.fn(() => new Promise(() => {})),
}));

const SETTINGS: UserSettingsDTO = {
  displayCurrency: "DKK",
  overviewPrefs: {
    brief: true,
    paydayGreeting: false,
    marketState: false,
    incomeRoom: true,
    portfolioRoom: true,
    statStrip: false,
    performanceCard: true,
    incomeCard: true,
    portfolioCard: true,
    upcomingCard: true,
  },
  dividendTaxRate: null,
  autoAddDividends: true,
  allowNegativeDividendGrowth: true,
};

const INCOME: DividendIncomeDTO = {
  retroactive: [],
  projected: [],
  announced: [],
  perHolding: [],
  summary: {
    trailingTwelveMonthIncome: [],
    projectedTwelveMonthIncome: [{ amount: "100.00", currency: "DKK" }],
    monthlyBreakdown: [],
    receivedByYear: [],
  },
  incomeByGroup: { holdings: [], sector: [], currency: [] },
  dividendTaxRate: null,
  fxIncomplete: false,
  incomeRecordingOff: false,
};

function RateProbe() {
  const { rate, factor, taxed, isLoading } = useDividendTaxRate();
  return <div data-testid="probe">{`${rate}|${factor}|${taxed}|${isLoading}`}</div>;
}

function IncomeProbe() {
  const { data, gross, taxed } = useNetDividendIncome();
  return (
    <div data-testid="probe">
      {`${data?.summary.projectedTwelveMonthIncome[0]?.amount ?? "none"}|${gross?.summary.projectedTwelveMonthIncome[0]?.amount ?? "none"}|${taxed}`}
    </div>
  );
}

describe("useDividendTaxRate", () => {
  it("reports gross when no rate is configured", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.userSettings(), SETTINGS);
    renderWithClient(<RateProbe />, qc);
    expect(screen.getByTestId("probe").textContent).toBe("null|1|false|false");
  });

  it("converts a configured rate to a net factor", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.userSettings(), { ...SETTINGS, dividendTaxRate: 35 });
    renderWithClient(<RateProbe />, qc);
    expect(screen.getByTestId("probe").textContent).toBe("35|0.65|true|false");
  });

  it("reports isLoading (and gross-shaped rate/factor/taxed) while settings are still in flight", () => {
    const qc = makeTestQueryClient();
    // No setQueryData: the query has no cached data yet, so it is in flight.
    renderWithClient(<RateProbe />, qc);
    expect(screen.getByTestId("probe").textContent).toBe("null|1|false|true");
  });
});

describe("useNetDividendIncome", () => {
  it("returns the payload unchanged when no rate is set", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), INCOME);
    renderWithClient(<IncomeProbe />, qc);
    expect(screen.getByTestId("probe").textContent).toBe("100.00|100.00|false");
  });

  it("nets the payload from the rate carried on the payload itself, while also exposing the raw gross payload", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), { ...INCOME, dividendTaxRate: 35 });
    renderWithClient(<IncomeProbe />, qc);
    // data (netted) = 65.00, gross (raw, un-netted) = 100.00 — both available
    // from one query, so callers never need to divide net back out by factor.
    expect(screen.getByTestId("probe").textContent).toBe("65.00|100.00|true");
  });

  it("at a 100% tax rate, data nets to 0 while gross still holds the real figure — no NaN", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), { ...INCOME, dividendTaxRate: 100 });
    renderWithClient(<IncomeProbe />, qc);
    expect(screen.getByTestId("probe").textContent).toBe("0.00|100.00|true");
  });
});
