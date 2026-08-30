import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import { qk } from "../lib/query/keys";

vi.mock("../lib/api", () => ({
  getPortfolioHistory: vi.fn(),
}));

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
  const ColorType = { Solid: "solid", VerticalGradient: "gradient" };
  const chartStub = {
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    AreaSeries: "Area",
    LineSeries: "Line",
    LineStyle,
    ColorType,
  };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import { PortfolioChart } from "./portfolio-chart";
import { getPortfolioHistory } from "../lib/api";
import type { PortfolioHistoryDTO, DashboardDTO } from "../lib/types";

const history: PortfolioHistoryDTO = {
  points: [
    {
      date: "2026-01-01",
      value: { amount: "10000", currency: "USD" },
      invested: { amount: "9000", currency: "USD" },
    },
    {
      date: "2026-07-09",
      value: { amount: "11000", currency: "USD" },
      invested: { amount: "9500", currency: "USD" },
    },
  ],
  changePercent: 10,
  changeAmount: { amount: "1000", currency: "USD" },
};

const todayChange: DashboardDTO["todayChange"] = {
  amount: { amount: "150", currency: "USD" },
  percent: 1.5,
};

beforeEach(() => vi.clearAllMocks());

describe("PortfolioChart", () => {
  it("renders from the seeded portfolio-history cache without fetching", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioHistory("1Y", null, []), history);

    const { container } = renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      qc,
    );
    const hero = container.querySelector(".hero-num");
    expect(hero?.textContent).toBe("$11,000.00");
    expect(getPortfolioHistory).not.toHaveBeenCalled();
  });

  it("renders the hero number from initialHistory via initialData, without fetching", () => {
    const { container } = renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    const hero = container.querySelector(".hero-num");
    expect(hero?.textContent).toBe("$11,000.00");
    expect(getPortfolioHistory).not.toHaveBeenCalled();
  });

  it("omits the today chip and label when todayChange is null", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    expect(screen.queryByText("today")).not.toBeInTheDocument();
  });

  it("renders the today chip and label when todayChange is present", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={todayChange} />,
      makeTestQueryClient(),
    );
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(screen.getByText("+$150.00")).toBeInTheDocument();
  });

  it("shows the quiet range line with 'past year' wording for the default 1Y range", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    expect(screen.getByText(/past year/)).toBeInTheDocument();
    expect(screen.getByText(/\+\$1,000\.00/)).toBeInTheDocument();
  });

  it("fetches a new range when the segmented control changes, passing through displayCurrency", async () => {
    vi.mocked(getPortfolioHistory).mockResolvedValue({
      ...history,
      points: [history.points[1]!],
    });

    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency="EUR" todayChange={null} />,
      makeTestQueryClient(),
    );

    fireEvent.click(screen.getByRole("radio", { name: "3M" }));

    await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalled());
    const [range, currency, benchmarks] = vi.mocked(getPortfolioHistory).mock.calls[0]!;
    expect(range).toBe("3M");
    expect(currency).toBe("EUR");
    expect(benchmarks == null || benchmarks.length === 0).toBe(true);
  });

  it("does not refetch the default key when it is already cached", () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.portfolioHistory("1Y", "EUR", []), history);

    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency="EUR" todayChange={null} />,
      qc,
    );

    expect(getPortfolioHistory).not.toHaveBeenCalled();
  });

  it("labels the chart when a date had no historical rate and fell back to spot", () => {
    renderWithClient(
      <PortfolioChart
        initialHistory={{ ...history, fxApproximated: true }}
        displayCurrency={null}
        todayChange={null}
      />,
      makeTestQueryClient(),
    );
    expect(screen.getByText(/today's rate was used/i)).toBeInTheDocument();
  });

  it("does not show the approximation notice when every date priced from history", () => {
    renderWithClient(
      <PortfolioChart
        initialHistory={{ ...history, fxApproximated: false }}
        displayCurrency={null}
        todayChange={null}
      />,
      makeTestQueryClient(),
    );
    expect(screen.queryByText(/today's rate was used/i)).not.toBeInTheDocument();
  });

  it("warns when the rates behind the chart have not refreshed in weeks", () => {
    renderWithClient(
      <PortfolioChart
        initialHistory={{ ...history, fxStale: true, fxRatesAsOf: "2026-07-01" }}
        displayCurrency={null}
        todayChange={null}
      />,
      makeTestQueryClient(),
    );
    expect(screen.getByText(/have not refreshed since 2026-07-01/i)).toBeInTheDocument();
  });

  it("warns when a holding's currency could not be priced at all", () => {
    renderWithClient(
      <PortfolioChart
        initialHistory={{ ...history, fxIncomplete: true }}
        displayCurrency={null}
        todayChange={null}
      />,
      makeTestQueryClient(),
    );
    expect(screen.getByText(/left out of this chart entirely/i)).toBeInTheDocument();
  });

  it("shows no FX banner at all when rates are fresh and complete", () => {
    renderWithClient(
      <PortfolioChart
        initialHistory={{
          ...history,
          fxApproximated: false,
          fxStale: false,
          fxIncomplete: false,
        }}
        displayCurrency={null}
        todayChange={null}
      />,
      makeTestQueryClient(),
    );
    expect(screen.queryByText(/exchange rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/left out of this chart/i)).not.toBeInTheDocument();
  });
  // The chart's line is cumulative net invested -- contributions minus
  // withdrawals -- which is NOT the cost basis of the current holdings. The two
  // diverge by realised gains, and trackers that plot cost-of-holdings count
  // recycled profit as money the user put in. Calling this line "invested"
  // made Sage look wrong against them while it was the one being precise, so
  // the word is reserved and the difference is explained.
  it("labels the line money in, never invested", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    expect(screen.getByRole("button", { name: /money in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^invested$/i })).not.toBeInTheDocument();
  });

  it("explains why money in can sit below the cost of current holdings", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    expect(screen.getByTitle(/contributions minus withdrawals/i)).toBeInTheDocument();
  });

  // jsdom's cssstyle does not resolve CSS custom properties, so this can only
  // catch a literal copy-paste typo (e.g. both swatches wired to the same
  // `--chart-comparison-*` variable name). It cannot tell whether the two
  // variables resolve to the same colour -- that guarantee lives in
  // packages/ui/src/styles/tokens.test.ts, which reads tokens.css and compares
  // the actual resolved values.
  it("wires each benchmark legend swatch to its own CSS variable, not a shared one", async () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    const sp = await screen.findByRole("button", { name: /S&P 500/ });
    const msci = await screen.findByRole("button", { name: /MSCI World/ });
    const swatch = (b: HTMLElement) => b.querySelector("[data-series-swatch]") as HTMLElement;
    expect(swatch(sp)).toBeTruthy();
    expect(swatch(msci)).toBeTruthy();
    expect(swatch(sp).style.background).not.toBe(swatch(msci).style.background);
  });
});
