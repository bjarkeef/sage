import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../../lib/test/render-with-client";
import { qk } from "../../../../lib/query/keys";
import type { AssetDetailDTO, UserSettingsDTO } from "../../../../lib/types";

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ symbol: "AAPL" })),
  // RemoveHoldingButton (rendered whenever position.held is true) calls
  // useRouter() unconditionally, even though this file's new locked-dialog
  // test never triggers navigation.
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
  const ColorType = { Solid: "solid", VerticalGradient: "gradient" };
  const chartStub = {
    addSeries: vi.fn(() => ({
      setData: vi.fn(),
      createPriceLine: vi.fn(),
      attachPrimitive: vi.fn(),
    })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
    AreaSeries: "Area",
    LineSeries: "Line",
    LineStyle,
    ColorType,
  };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("../../../../lib/api", () => ({
  getAssetDetail: vi.fn(),
  getAssetChart: vi.fn(),
  // Never resolves: every test below either seeds userSettings into the cache
  // directly (staleTime keeps this queryFn from ever firing) or, for the
  // "still loading" regression test, relies on it staying pending forever so
  // the settings query is observably in flight.
  getUserSettings: vi.fn(() => new Promise(() => {})),
  // TransactionDialog's fixed-instrument effect calls getInstrumentQuote(...)
  // .then(...) as soon as it opens; a bare vi.fn() returns undefined here,
  // which throws. Resolved value doesn't matter for the tests in this file.
  getInstrumentQuote: vi.fn(),
}));

// Import after the mocks above so AssetDetailPage's transitive deps pick them up.
import AssetDetailPage from "./page";
import * as api from "../../../../lib/api";
import { useParams as useParamsMock } from "next/navigation";

const FIXTURE_ASSET: AssetDetailDTO = {
  profile: {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    assetType: "stock",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: "3000000000000",
    peRatio: "30",
    beta: "1.2",
    fiftyTwoWeekHigh: { amount: "200", currency: "USD" },
    fiftyTwoWeekLow: { amount: "150", currency: "USD" },
    dividendYield: "0.005",
    trailingAnnualDividend: { amount: "1", currency: "USD" },
    website: null,
    description: null,
    ceo: null,
    fullTimeEmployees: null,
    ipoDate: null,
    country: null,
    countryIso: null,
    fund: null,
  },
  quote: { price: { amount: "180", currency: "USD" }, asOf: "2026-07-13" },
  chart: [{ date: "2026-07-01", close: { amount: "175", currency: "USD" } }],
  dividends: { history: [], cagr5y: null, trailingTwelveMonthTotal: "0" },
  position: { held: false },
  income: {
    currentYield: null,
    yieldOnCost: null,
    annualDividend: null,
    dividendGrowth5y: null,
    nextExDate: null,
    payoutRatio: null,
  },
  custom: null,
};

const FIXTURE_CUSTOM_ASSET: AssetDetailDTO = {
  ...FIXTURE_ASSET,
  profile: {
    ...FIXTURE_ASSET.profile,
    symbol: "CASH_DKK",
    name: "Cash account",
    assetType: "other",
    sector: null,
    industry: null,
    dividendYield: null,
    trailingAnnualDividend: null,
  },
  custom: {
    holdingType: "savings",
    note: "Emergency fund",
    income: {
      yearlyPct: "4.25",
      frequencyUnit: "quarter",
      frequencyInterval: 1,
      firstPaymentDate: "2026-04-30",
      lastPaymentDate: null,
      reinvest: true,
      nextPaymentDate: "2026-07-30",
    },
  },
};

const FIXTURE_SETTINGS: UserSettingsDTO = {
  displayCurrency: null,
  overviewPrefs: {
    brief: true,
    paydayGreeting: true,
    marketState: true,
    incomeRoom: true,
    portfolioRoom: true,
    statStrip: false,
    goalBand: true,
    performanceCard: true,
    incomeCard: true,
    portfolioCard: true,
    upcomingCard: true,
  },
  dividendTaxRate: null,
  autoAddDividends: true,
  allowNegativeDividendGrowth: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getInstrumentQuote).mockResolvedValue(null);
});

describe("AssetDetailPage", () => {
  it("renders seeded cache data without refetching the asset detail", async () => {
    const detailSpy = vi.spyOn(api, "getAssetDetail");

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetDetail("AAPL"), FIXTURE_ASSET);
    qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);

    renderWithClient(<AssetDetailPage />, qc);

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());
    expect(detailSpy).not.toHaveBeenCalled();
  });

  it("renders custom-holding income settings and the Edit link for a custom symbol", async () => {
    vi.mocked(useParamsMock).mockReturnValue({ symbol: "CASH_DKK" });

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetDetail("CASH_DKK"), FIXTURE_CUSTOM_ASSET);
    qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);

    renderWithClient(<AssetDetailPage />, qc);

    await waitFor(() => expect(screen.getByText("Cash account")).toBeInTheDocument());

    // Holding-type chip + Edit link, from asset-header.tsx.
    expect(screen.getByText("Savings account")).toBeInTheDocument();
    const editLink = screen.getByRole("link", { name: "Edit" });
    expect(editLink).toHaveAttribute("href", "/custom-holding/CASH_DKK/edit");

    // Income settings row, from income-section.tsx.
    expect(screen.getByText("4.25%")).toBeInTheDocument();
    expect(screen.getByText("Every quarter")).toBeInTheDocument();
    // formatDate omits the year when it matches the current year.
    expect(screen.getByText(/^Jul 30(, 2026)?$/)).toBeInTheDocument();
    expect(screen.getByText("Reinvested")).toBeInTheDocument();

    // Quick actions.
    expect(screen.getByRole("button", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update price" })).toBeInTheDocument();
  });

  it("opens the add-transaction dialog locked to the asset page's own instrument", async () => {
    // vitest's clearAllMocks() clears call history but not a mockReturnValue
    // set by an earlier test — the previous test points useParams at
    // "CASH_DKK", which would make the assetDetail query key below miss
    // what's seeded here.
    vi.mocked(useParamsMock).mockReturnValue({ symbol: "AAPL" });

    const qc = makeTestQueryClient();
    // held: true (not custom) is enough to show the quick actions row; this
    // is the plain "already own this stock" case the fix targets.
    qc.setQueryData(qk.assetDetail("AAPL"), { ...FIXTURE_ASSET, position: { held: true } });
    qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);

    renderWithClient(<AssetDetailPage />, qc);

    fireEvent.click(await screen.findByRole("button", { name: "Add transaction" }));

    // Regression this guards: deleting the `instrument` prop from the page's
    // TransactionDialog call still renders a button labeled "Add transaction"
    // and still opens a dialog, so a label-only assertion can't catch it. The
    // only observable difference is what's *inside* the dialog — the profile
    // already on this page, with no search box to go find AAPL again.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("AAPL")).toBeInTheDocument();
    expect(within(dialog).getByText("Apple Inc.")).toBeInTheDocument();
    // Absence, not merely hidden: a locked InstrumentPicker never mounts
    // InstrumentSearch, so its search input doesn't exist in the DOM at all.
    expect(screen.queryByPlaceholderText("Search ticker or name…")).not.toBeInTheDocument();
    // Regression this guards: InstrumentPicker renders the identity row
    // whenever `instrument` is non-null regardless of `locked`, so the
    // assertions above pass even if the page stopped passing `lockedInstrument`
    // to the dialog. The Change button is the only observable difference, and
    // it would let this dialog swap AAPL out from under a page built around it.
    expect(within(dialog).queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("stays in the loading state — never renders a gross yield — while the dividend tax rate is still loading", () => {
    // Regression test: on a cold load where asset detail resolves before user
    // settings, useDividendTaxRate() used to expose no isLoading, so the page
    // gated only on the assetDetail query. rate/taxed came back null/false
    // (indistinguishable from "no rate configured"), so IncomeSection briefly
    // rendered a GROSS "Current yield" captioned as if no rate were set, then
    // silently flipped to net once settings arrived. The page must instead OR
    // both loading states together and hold the loading skeleton until the
    // tax rate has actually settled.
    //
    // Reset explicitly rather than relying on the file's beforeEach: vitest's
    // clearAllMocks() clears call history but NOT a mockReturnValue set by an
    // earlier test, and the previous test in this file points useParams at
    // "CASH_DKK" — without this, the assetDetail query key below wouldn't
    // match what's seeded and the test would "pass" for the wrong reason (an
    // asset-fetch miss, not the tax-rate-loading gate under test).
    vi.mocked(useParamsMock).mockReturnValue({ symbol: "AAPL" });

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetDetail("AAPL"), {
      ...FIXTURE_ASSET,
      income: {
        currentYield: 0.05,
        yieldOnCost: 0.06,
        annualDividend: { amount: "4.12", currency: "USD" },
        dividendGrowth5y: null,
        nextExDate: null,
        payoutRatio: null,
      },
    });
    // userSettings deliberately NOT seeded — getUserSettings (mocked above to
    // never resolve) is left in flight, simulating settings landing after
    // asset detail on a cold load.

    renderWithClient(<AssetDetailPage />, qc);

    // Still showing the loading skeleton, not the page content.
    expect(screen.getByRole("status", { name: "Loading chart" })).toBeInTheDocument();
    expect(screen.queryByText("Apple Inc.")).not.toBeInTheDocument();

    // Above all: no gross yield figure ever hit the DOM.
    expect(screen.queryByText("Current yield")).not.toBeInTheDocument();
    expect(screen.queryByText("5.00%")).not.toBeInTheDocument();
  });

  // The position strip took no tax rate at all, so it rendered gross while the
  // Income card below it rendered net — the same label, the same quantity, two
  // different numbers on one screen, with the "After tax" caption attached to a
  // different figure in a different card. The identical defect was found and
  // fixed once on the dividends analytics page and still shipped here, which is
  // why this asserts the invariant rather than the two literals.
  it("never shows the same income figure gross in one section and net in another", async () => {
    vi.mocked(useParamsMock).mockReturnValue({ symbol: "AAPL" });

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.assetDetail("AAPL"), {
      ...FIXTURE_ASSET,
      position: {
        held: true,
        quantity: "10",
        averageCost: { amount: "100", currency: "USD" },
        costBasis: { amount: "1000", currency: "USD" },
        marketValue: { amount: "1800", currency: "USD" },
        unrealizedGainLoss: { amount: "800", currency: "USD" },
        gainLossPercent: 0.8,
        yieldOnCost: 0.06,
        forwardAnnualIncome: { amount: "60.00", currency: "USD" },
        totalDividendIncome: "40.00",
        feesPaid: null,
        trades: [],
      },
      income: {
        currentYield: 0.05,
        yieldOnCost: 0.06,
        annualDividend: { amount: "4.12", currency: "USD" },
        dividendGrowth5y: null,
        nextExDate: null,
        payoutRatio: null,
      },
    });
    qc.setQueryData(qk.userSettings(), { ...FIXTURE_SETTINGS, dividendTaxRate: 35 });

    renderWithClient(<AssetDetailPage />, qc);

    await waitFor(() => expect(screen.getByText("Apple Inc.")).toBeInTheDocument());

    // 6.00% netted at 35% is 3.90%, and BOTH renders of yield on cost must say
    // so. The gross figure must not appear anywhere on the page.
    expect(screen.getAllByText("3.90%").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("6.00%")).not.toBeInTheDocument();

    // The other two income figures in the strip net on the same rate.
    expect(screen.queryByText("$60.00")).not.toBeInTheDocument();
    expect(screen.queryByText("$40.00")).not.toBeInTheDocument();

    // And the basis is stated on the figures themselves, not only in a caption
    // belonging to a different card.
    expect(screen.getAllByText(/after tax/i).length).toBeGreaterThanOrEqual(2);
  });
});
