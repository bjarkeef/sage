import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { PortfolioDTO } from "../../../lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../../../lib/api", () => ({
  getPortfolio: vi.fn(),
  // Must resolve a promise, not return undefined: react-query rejects
  // undefined query data ("Query data cannot be undefined") the moment a test
  // exercises the unpriced-holdings callout, which reads this query.
  getSystemStatus: vi.fn(() =>
    Promise.resolve({
      environment: {
        nodeEnv: "test",
        nodeVersion: "v22.0.0",
        uptimeSeconds: 0,
        signups: "open",
        schemaMigrations: null,
      },
      providers: {
        marketData: "yahoo",
        enrichment: "none",
        keys: { eodhd: false },
        health: [],
        pricesAgeSeconds: null,
        pricesStale: false,
        pricesMissing: 0,
      },
      fx: { displayCurrency: null, ratesAsOf: null, coverageFrom: null, pairs: [] },
    }),
  ),
  listTransactions: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  deleteTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));

// Import after the mocks above so HoldingsClient's transitive deps pick them up.
import { HoldingsClient } from "./holdings-client";
import * as api from "../../../lib/api";

const FIXTURE_PORTFOLIO: PortfolioDTO = {
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
  ],
  subtotalsByCurrency: [
    {
      currency: "USD",
      costBasis: { amount: "1500", currency: "USD" },
      marketValue: { amount: "1800", currency: "USD" },
      gainLoss: { amount: "300", currency: "USD" },
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

function renderHoldings() {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);
  // Infinite-query shape used by TransactionsList
  qc.setQueryData(qk.transactions(), {
    pages: [{ items: [], nextCursor: null }],
    pageParams: [undefined],
  });
  return renderWithClient(<HoldingsClient />, qc);
}

describe("HoldingsClient", () => {
  it("renders seeded cache data without refetching the portfolio", async () => {
    const portfolioSpy = vi.spyOn(api, "getPortfolio");

    renderHoldings();

    await waitFor(() => expect(screen.getByText("Holdings")).toBeInTheDocument());
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(portfolioSpy).not.toHaveBeenCalled();
  });

  it("offers the primary action from the page header", async () => {
    renderHoldings();
    const heading = await screen.findByRole("heading", { name: "Holdings" });
    const header = heading.closest("div")!.parentElement!;
    expect(within(header).getByRole("button", { name: /add transaction/i })).toBeInTheDocument();
  });

  it("gives the sort control radio semantics", async () => {
    renderHoldings();
    // It was five independently-pressed `aria-pressed` toggle buttons, each
    // reachable and announced on its own -- but toggle semantics for a
    // single-choice control, not the mutually-exclusive radio group this is
    // (/dividends already used SegmentedControl for the same job).
    const group = await screen.findByRole("radiogroup", { name: /sort/i });
    expect(within(group).getByRole("radio", { name: "Value" })).toBeChecked();
  });
});
