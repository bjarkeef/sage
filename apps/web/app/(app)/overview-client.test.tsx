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
import { allByMoney } from "../../lib/test/by-money";
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
  totalReturn: { amount: { amount: "500", currency: "USD" } },
  ytdTwr: 0.08,
  ytdTwrIncomplete: false,
  relative: null,
  benchmarkYtdTwr: null,
  income: {
    projectedTwelveMonth: { amount: "1284.00", currency: "USD" },
    trailingTwelveMonth: { amount: "1100.00", currency: "USD" },
    thisMonth: {
      received: { amount: "100", currency: "USD" },
      projected: { amount: "200", currency: "USD" },
    },
    dividendTaxRate: 35,
  },
  incomeStream: [],
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
    stalePrices: [],
  },
};

const FIXTURE_SETTINGS: UserSettingsDTO = {
  name: "Test User",
  displayCurrency: "USD",
  overviewPrefs: {
    brief: true,
    paydayGreeting: false,
    marketState: false,
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

    // Netted through the fixture's 35% rate: 1284.00 gross -> 834.60.
    await waitFor(() => expect(allByMoney("$834.60")).toHaveLength(1));
    expect(dashSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  it("hides the stat strip by default and shows it when statStrip is on", async () => {
    const { queryClient } = renderOverview({ statStrip: false });
    await screen.findByText("Income · next twelve months");
    expect(screen.queryByText("YTD return")).not.toBeInTheDocument();

    queryClient.setQueryData(qk.userSettings(), {
      ...FIXTURE_SETTINGS,
      overviewPrefs: { ...FIXTURE_SETTINGS.overviewPrefs, statStrip: true },
    });

    await screen.findByText("YTD return");
  });

  it("hides a card when its pref is off", async () => {
    renderOverview({ upcomingCard: false });
    await screen.findByText("Income · next twelve months");
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
  });

  it("nets the Upcoming card's dividend amounts through the real page wiring", async () => {
    renderOverview();
    await screen.findByText("Income · next twelve months");
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

  it("opens with no greeting and no figure the page already prints", async () => {
    renderOverview({});
    await screen.findByText("Income · next twelve months");
    // Two rejected patterns, both of which have shipped before. A greeting used
    // as information ("Good evening, Sage") duplicates the eyebrow two lines
    // up and spends the one slot that could carry a fact; "stands at" restated
    // a figure already set in the largest type on the page.
    expect(document.body.textContent).not.toContain("stands at");
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).not.toBeInTheDocument();
  });

  /** The book's worth is no longer the hero — it is one fact on the supporting
   *  line under the stream. What survives from the old hero is the rule it was
   *  built to enforce: this app does not sum across currencies, and it says so
   *  rather than quietly dropping the row. */
  describe("book value on the supporting line", () => {
    function renderWithDashboard(overrides: Partial<DashboardDTO>) {
      const qc = makeTestQueryClient();
      qc.setQueryData(qk.dashboard(), { ...FIXTURE_DASHBOARD, ...overrides });
      qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);
      return renderWithClient(<OverviewClient />, qc);
    }

    const usd = {
      currency: "USD",
      costBasis: { amount: "3197", currency: "USD" },
      marketValue: { amount: "3197", currency: "USD" },
      gainLoss: { amount: "0", currency: "USD" },
    };

    it("reads the subtotal when the book is in one currency", async () => {
      renderWithDashboard({ subtotalsByCurrency: [usd] });
      await waitFor(() => expect(allByMoney("$3,197.00")).toHaveLength(1));
    });

    /** Summing across currencies is the one thing this app refuses to do, so
     *  here the dash is the right answer rather than a gap to be filled — and
     *  the label stays, so the refusal is visible instead of silent. */
    it("keeps the label against a dash when the book spans more than one", async () => {
      renderWithDashboard({
        subtotalsByCurrency: [
          usd,
          {
            currency: "EUR",
            costBasis: { amount: "1000", currency: "EUR" },
            marketValue: { amount: "1100", currency: "EUR" },
            gainLoss: { amount: "100", currency: "EUR" },
          },
        ],
      });

      await screen.findByText("Income · next twelve months");
      expect(screen.getByText("Book value")).toBeInTheDocument();
      expect(screen.queryByText("$3,197.00")).not.toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("prints the book's value once, not once per component that knows it", async () => {
      // The chart's stat strip briefly carried a "Worth" cell repeating the
      // hero numeral a few pixels below it. The chart is lazily imported, so a
      // plain findByText can resolve before the duplicate mounts and pass on a
      // page that is wrong — CI, on different timing, found both. Waiting for
      // the chart's own copy and then counting cannot race.
      renderWithDashboard({ subtotalsByCurrency: [usd] });

      await screen.findByText(/Money in/);
      expect(allByMoney("$3,197.00")).toHaveLength(1);
    });
  });
});
