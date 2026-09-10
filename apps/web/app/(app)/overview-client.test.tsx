import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../lib/test/render-with-client";
import { qk } from "../../lib/query/keys";
import type { DashboardDTO, UserSettingsDTO, OverviewPrefs } from "../../lib/types";

const useSession = vi.fn<() => { data: { user: { name: string } } | null }>();
vi.mock("../../lib/auth-client", () => ({
  authClient: { useSession: () => useSession() },
}));

vi.mock("lightweight-charts", async () => {
  const { lightweightChartsStub } = await import("../../lib/test/lightweight-charts-stub");
  return lightweightChartsStub();
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

// Import after the mocks above so OverviewClient's transitive deps pick them up.
import { OverviewClient } from "./overview-client";
import * as api from "../../lib/api";

const FIXTURE_DASHBOARD: DashboardDTO = {
  displayCurrency: "USD",
  positions: [
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
      currency: "USD",
      nativeCurrency: "USD",
      quantity: "10",
      averageCost: { amount: "150", currency: "USD" },
      costBasis: { amount: "1500", currency: "USD" },
      currentPrice: { amount: "180", currency: "USD" },
      marketValue: { amount: "1800", currency: "USD" },
      unrealizedGainLoss: { amount: "300", currency: "USD" },
      gainLossPercent: 20,
      dailyChange: { amount: "18", currency: "USD" },
      dailyChangePercent: 1.0,
      dividendIncome: null,
      totalReturn: null,
      totalReturnPercent: null,
      website: null,
      yieldOnCost: null,
      basisMismatch: null,
    },
    {
      symbol: "NORDA-B",
      name: "Norda Industri",
      exchange: "CPH",
      currency: "DKK",
      nativeCurrency: "DKK",
      quantity: "5",
      averageCost: { amount: "500", currency: "DKK" },
      costBasis: { amount: "2500", currency: "DKK" },
      currentPrice: { amount: "550", currency: "DKK" },
      marketValue: { amount: "2750", currency: "DKK" },
      unrealizedGainLoss: { amount: "250", currency: "DKK" },
      gainLossPercent: 10,
      dailyChange: { amount: "27.5", currency: "DKK" },
      dailyChangePercent: -0.8,
      dividendIncome: null,
      totalReturn: null,
      totalReturnPercent: null,
      website: null,
      yieldOnCost: null,
      basisMismatch: null,
    },
  ],
  subtotalsByCurrency: [],
  todayChange: { amount: { amount: "45", currency: "USD" }, percent: 1.2 },
  totalReturn: { amount: { amount: "500", currency: "USD" }, percent: 50 },
  ytdTwr: 0.08,
  ytdTwrIncomplete: false,
  relative: null,
  benchmarkYtdTwr: null,
  income: {
    projectedTwelveMonth: null,
    trailingTwelveMonth: null,
    thisMonth: {
      received: { amount: "100", currency: "USD" },
      projected: { amount: "200", currency: "USD" },
    },
    dividendTaxRate: 35,
  },
  upcomingDividends: [
    {
      symbol: "O",
      name: "Realty Income",
      date: "2030-01-15",
      income: "40.00",
      currency: "USD",
      dateEstimated: false,
      projected: false,
    },
  ],
  recentDividends: [],
  allocation: [],
  history: {
    points: [
      {
        date: "2026-01-01",
        value: { amount: "4000", currency: "USD" },
        invested: { amount: "3800", currency: "USD" },
      },
      {
        date: "2026-07-12",
        value: { amount: "4550", currency: "USD" },
        invested: { amount: "4000", currency: "USD" },
      },
    ],
    changePercent: 10,
    changeAmount: { amount: "550", currency: "USD" },
  },
};

const EMPTY_CHANGE = { amount: "0", currency: "USD" };

const FIXTURE_SETTINGS: UserSettingsDTO = {
  displayCurrency: "USD",
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

/** Seeds the overview queries into a fresh test QueryClient, with the
 *  given overviewPrefs overrides layered onto the base fixture, and renders
 *  OverviewClient against it. Returns the queryClient so a test can push a
 *  settings update through the cache and observe the gated UI react — that's
 *  the "rerender" path for a component with no props of its own. */
function renderOverview(prefsOverrides: Partial<OverviewPrefs> = {}) {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.dashboard(), FIXTURE_DASHBOARD);
  qc.setQueryData(qk.userSettings(), {
    ...FIXTURE_SETTINGS,
    overviewPrefs: { ...FIXTURE_SETTINGS.overviewPrefs, ...prefsOverrides },
  });
  const result = renderWithClient(<OverviewClient />, qc);
  return { ...result, queryClient: qc };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useSession.mockReturnValue({ data: null });
});

describe("OverviewClient", () => {
  it("renders seeded cache data without refetching", async () => {
    const dashSpy = vi.spyOn(api, "getDashboard");
    const settingsSpy = vi.spyOn(api, "getUserSettings");

    // Production defaults (lib/query/client.ts) via makeTestQueryClient: a
    // 60s staleTime means data seeded "now" is still fresh at mount, so no
    // background refetch fires — proving hydration is actually served from
    // cache, not just fast enough to race a refetch.
    renderOverview();

    await waitFor(() => expect(screen.getByText("$4,550.00")).toBeInTheDocument());
    expect(dashSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  it("hides the stat strip by default and shows it when statStrip is on", async () => {
    const { queryClient } = renderOverview({ statStrip: false });
    await screen.findByText(/Good /);
    expect(screen.queryByText("YTD return")).not.toBeInTheDocument();

    queryClient.setQueryData(qk.userSettings(), {
      ...FIXTURE_SETTINGS,
      overviewPrefs: { ...FIXTURE_SETTINGS.overviewPrefs, statStrip: true },
    });

    await screen.findByText("YTD return");
  });

  it("hides a card when its pref is off", async () => {
    renderOverview({ upcomingCard: false });
    await screen.findByText(/Good /);
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
  });

  it("nets the Upcoming card's dividend amounts through the real page wiring", async () => {
    renderOverview();
    await screen.findByText(/Good /);
    // FIXTURE_DASHBOARD's upcoming dividend is gross $40.00 with a 35% tax
    // rate configured: the card must show the netted $26.00 and never the raw
    // gross figure, pinning overview-client.tsx's netting wire-up (regressing
    // to the raw array, or double-netting, must fail this). Scoped to the
    // Upcoming card itself since the Income card beside it renders its own
    // "After tax" label from the same tax rate.
    const upcomingCard = screen.getByText("Upcoming").closest(".rounded-card") as HTMLElement;
    expect(within(upcomingCard).getByText(/26\.00/)).toBeInTheDocument();
    expect(within(upcomingCard).queryByText(/40\.00/)).not.toBeInTheDocument();
    expect(within(upcomingCard).getByText("After tax")).toBeInTheDocument();
  });

  it("greeting sentence carries no portfolio value or total day-change figure", async () => {
    renderOverview({});
    await screen.findByText(/Good /);
    expect(document.body.textContent).not.toContain("stands at");
  });

  /** The hero reads the last point of the value series, and that series is
   *  empty until a portfolio has a day of price history behind it. A first-run
   *  book whose only transaction is dated today rendered the biggest number on
   *  the page as an em dash, beside a today-change in full and above a
   *  Portfolio card showing the value — the page disagreed with itself. */
  describe("hero value with no history yet", () => {
    function renderWithDashboard(overrides: Partial<DashboardDTO>) {
      const qc = makeTestQueryClient();
      qc.setQueryData(qk.dashboard(), { ...FIXTURE_DASHBOARD, ...overrides });
      qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);
      return renderWithClient(<OverviewClient />, qc);
    }

    const noHistory = { points: [], changePercent: 0, changeAmount: EMPTY_CHANGE };

    it("falls back to the subtotal when the book is in one currency", async () => {
      renderWithDashboard({
        history: noHistory,
        subtotalsByCurrency: [
          {
            currency: "USD",
            costBasis: { amount: "3197", currency: "USD" },
            marketValue: { amount: "3197", currency: "USD" },
            gainLoss: { amount: "0", currency: "USD" },
          },
        ],
      });

      expect(await screen.findByText("$3,197.00")).toBeInTheDocument();
    });

    /** Summing across currencies is the one thing this app refuses to do, so
     *  here the dash is the right answer rather than a gap to be filled. */
    it("keeps the dash when the book spans more than one currency", async () => {
      renderWithDashboard({
        history: noHistory,
        subtotalsByCurrency: [
          {
            currency: "USD",
            costBasis: { amount: "3197", currency: "USD" },
            marketValue: { amount: "3197", currency: "USD" },
            gainLoss: { amount: "0", currency: "USD" },
          },
          {
            currency: "EUR",
            costBasis: { amount: "1000", currency: "EUR" },
            marketValue: { amount: "1100", currency: "EUR" },
            gainLoss: { amount: "100", currency: "EUR" },
          },
        ],
      });

      await screen.findByText(/Good /);
      expect(screen.queryByText("$3,197.00")).not.toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("still prefers the series once there is history", async () => {
      renderWithDashboard({
        subtotalsByCurrency: [
          {
            currency: "USD",
            costBasis: { amount: "1", currency: "USD" },
            marketValue: { amount: "1", currency: "USD" },
            gainLoss: { amount: "0", currency: "USD" },
          },
        ],
      });

      expect(await screen.findByText("$4,550.00")).toBeInTheDocument();
      expect(screen.queryByText("$1.00")).not.toBeInTheDocument();
    });
  });
});
