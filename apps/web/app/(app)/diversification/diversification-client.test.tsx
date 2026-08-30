import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { DiversificationViewDTO, MoneyDTO, UserSettingsDTO } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({
  getDiversification: vi.fn(),
  getUserSettings: vi.fn(),
}));

// Import after the mocks above so DiversificationClient's transitive deps pick them up.
import { DiversificationClient } from "./diversification-client";
import * as api from "../../../lib/api";

const FIXTURE_SETTINGS: UserSettingsDTO = {
  displayCurrency: "EUR",
  overviewPrefs: {
    brief: true,
    paydayGreeting: true,
    marketState: true,
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

const m = (amount: string): MoneyDTO => ({ amount, currency: "EUR" });

function dim(
  symbol: string,
  name: string,
  bucket: string,
  market: string,
  cost: string,
  extra: Partial<DiversificationViewDTO["dimensions"]["country"][number]> = {},
) {
  return {
    symbol,
    name,
    bucket,
    marketValue: m(market),
    costValue: m(cost),
    isFund: false,
    ...extra,
  };
}

/** Market split AAPL 80% / VOO 20%; cost split 25% / 75% — so the Buy-in
 *  toggle observably changes every percent in the UI. */
const FIXTURE: DiversificationViewDTO = {
  currency: "EUR",
  totals: { marketValue: m("1000.00"), costBasis: m("400.00") },
  dimensions: {
    sector: {
      plain: [
        dim("AAPL", "Apple Inc", "Technology", "800.00", "100.00"),
        dim("VOO", "Vanguard S&P 500", "Funds", "200.00", "300.00", { isFund: true }),
      ],
      xray: [
        dim("AAPL", "Apple Inc", "Technology", "800.00", "100.00"),
        dim("VOO", "Vanguard S&P 500", "Technology", "120.00", "180.00", {
          isFund: true,
          fundWeightPct: 60,
        }),
        dim("VOO", "Vanguard S&P 500", "Financial Services", "74.00", "111.00", {
          isFund: true,
          fundWeightPct: 37,
        }),
        dim("VOO", "Vanguard S&P 500", "Unknown", "6.00", "9.00", {
          isFund: true,
          fundWeightPct: 3,
        }),
      ],
    },
    country: [
      dim("AAPL", "Apple Inc", "United States", "800.00", "100.00"),
      dim("VOO", "Vanguard S&P 500", "United States", "200.00", "300.00", { isFund: true }),
    ],
    region: [
      dim("AAPL", "Apple Inc", "North America", "800.00", "100.00"),
      dim("VOO", "Vanguard S&P 500", "North America", "200.00", "300.00", { isFund: true }),
    ],
    assetClass: [
      dim("AAPL", "Apple Inc", "stock", "800.00", "100.00"),
      dim("VOO", "Vanguard S&P 500", "etf", "200.00", "300.00", { isFund: true }),
    ],
    currency: [
      dim("AAPL", "Apple Inc", "USD", "800.00", "100.00"),
      dim("VOO", "Vanguard S&P 500", "USD", "200.00", "300.00", { isFund: true }),
    ],
  },
  holdingsXray: [
    {
      key: "AAPL",
      symbol: "AAPL",
      name: "Apple Inc",
      marketValue: m("920.00"),
      costValue: m("280.00"),
      sources: [
        { type: "direct", marketValue: m("800.00"), costValue: m("100.00") },
        { type: "fund", fundSymbol: "VOO", marketValue: m("120.00"), costValue: m("180.00") },
      ],
    },
    {
      key: "VOO:other",
      symbol: null,
      name: "VOO — other holdings",
      marketValue: m("80.00"),
      costValue: m("120.00"),
      sources: [
        { type: "fund", fundSymbol: "VOO", marketValue: m("80.00"), costValue: m("120.00") },
      ],
    },
  ],
  fxIncomplete: false,
};

const EMPTY: DiversificationViewDTO = {
  currency: "EUR",
  totals: { marketValue: m("0.00"), costBasis: m("0.00") },
  dimensions: {
    sector: { plain: [], xray: [] },
    country: [],
    region: [],
    assetClass: [],
    currency: [],
  },
  holdingsXray: [],
  fxIncomplete: false,
};

function seedAndRender(data: DiversificationViewDTO = FIXTURE) {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);
  qc.setQueryData(qk.diversification("EUR"), data);
  renderWithClient(<DiversificationClient />, qc);
  return qc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe("DiversificationClient query gating", () => {
  it("fetches diversification exactly once, keyed by the resolved currency (no null-then-refetch)", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification").mockResolvedValue(FIXTURE);
    const settingsDeferred = deferred<UserSettingsDTO>();
    const settingsSpy = vi.spyOn(api, "getUserSettings").mockReturnValue(settingsDeferred.promise);

    renderWithClient(<DiversificationClient />, makeTestQueryClient());

    await waitFor(() => expect(settingsSpy).toHaveBeenCalledTimes(1));
    expect(diversificationSpy).not.toHaveBeenCalled();

    settingsDeferred.resolve(FIXTURE_SETTINGS);

    await waitFor(() => expect(screen.getAllByText("Technology").length).toBeGreaterThan(0));
    expect(diversificationSpy).toHaveBeenCalledTimes(1);
    expect(diversificationSpy).toHaveBeenCalledWith("EUR");
  });

  it("does not refetch when diversification data is also seeded", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification");
    seedAndRender();
    await waitFor(() => expect(screen.getAllByText("Technology").length).toBeGreaterThan(0));
    expect(diversificationSpy).not.toHaveBeenCalled();
  });

  it("degrades gracefully instead of hanging forever when settings hard-fail", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification").mockResolvedValue(FIXTURE);
    const settingsSpy = vi.spyOn(api, "getUserSettings").mockRejectedValue(new Error("boom"));

    renderWithClient(<DiversificationClient />, makeTestQueryClient());

    await waitFor(() => expect(settingsSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(diversificationSpy).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getAllByText("Technology").length).toBeGreaterThan(0));
  });
});

describe("DiversificationClient toggles", () => {
  it("X-Ray splits funds into sectors and reveals the remainder constituent, without refetching", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification");
    seedAndRender();
    await waitFor(() => expect(screen.getByText("Funds")).toBeInTheDocument());
    expect(screen.queryByText("Financial Services")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "X-Ray funds" }));

    expect(screen.getByText("Financial Services")).toBeInTheDocument();
    expect(screen.queryByText("Funds")).not.toBeInTheDocument();
    expect(screen.getByText("VOO — other holdings")).toBeInTheDocument();
    expect(diversificationSpy).not.toHaveBeenCalled();
  });

  it("Buy in recomputes every percent from cost basis, without refetching", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification");
    seedAndRender();
    await waitFor(() => expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("75.0%")).toHaveLength(0);

    fireEvent.click(screen.getByRole("switch", { name: "Buy in" }));

    expect(screen.queryAllByText("80.0%")).toHaveLength(0);
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    expect(diversificationSpy).not.toHaveBeenCalled();
  });

  it("Show holdings expands buckets into member rows (x-ray slices labeled with fund weight), without refetching", async () => {
    const diversificationSpy = vi.spyOn(api, "getDiversification");
    seedAndRender();
    await waitFor(() => expect(screen.getByText("Funds")).toBeInTheDocument());
    expect(screen.queryByText("VOO (37.00%)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "X-Ray funds" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show holdings" }));

    expect(screen.getByText("VOO (37.00%)")).toBeInTheDocument();
    expect(diversificationSpy).not.toHaveBeenCalled();
  });

  it("shows the FX-unavailable footnote only when fxIncomplete is set", async () => {
    seedAndRender();
    await waitFor(() => expect(screen.getByText("Funds")).toBeInTheDocument());
    expect(screen.queryByText(/Exchange rates are currently unavailable/)).not.toBeInTheDocument();
    cleanup();
    seedAndRender({ ...FIXTURE, fxIncomplete: true });
    await waitFor(() =>
      expect(screen.getByText(/Exchange rates are currently unavailable/)).toBeInTheDocument(),
    );
  });

  it("renders header and no charts for an empty portfolio", async () => {
    seedAndRender(EMPTY);
    await waitFor(() => expect(screen.getByText("Diversification")).toBeInTheDocument());
    expect(screen.queryByText("All holdings")).not.toBeInTheDocument();
  });

  /** Every card returns null on an empty bucket list, so this page used to draw
   *  a title, a subtitle and three toggles over nothing — the only page in the
   *  app with no empty state. Switches with nothing to switch read as broken. */
  it("explains itself, and offers a way out, when there is nothing to spread", async () => {
    seedAndRender(EMPTY);

    expect(await screen.findByText(/Nothing to spread yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import transactions/ })).toHaveAttribute(
      "href",
      "/import",
    );
  });

  it("hides the toggles until there is something to toggle", async () => {
    seedAndRender(EMPTY);

    await screen.findByText(/Nothing to spread yet/);
    expect(screen.queryByText("X-Ray funds")).not.toBeInTheDocument();
    expect(screen.queryByText("Buy in")).not.toBeInTheDocument();
    expect(screen.queryByText("Show holdings")).not.toBeInTheDocument();
  });

  it("still shows the toggles once the book has holdings", async () => {
    seedAndRender(FIXTURE);

    await waitFor(() => expect(screen.getByText("X-Ray funds")).toBeInTheDocument());
    expect(screen.queryByText(/Nothing to spread yet/)).not.toBeInTheDocument();
  });
});
