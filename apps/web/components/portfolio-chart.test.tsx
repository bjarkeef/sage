import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import { qk } from "../lib/query/keys";

vi.mock("../lib/api", () => ({
  getPortfolioHistory: vi.fn(),
}));

vi.mock("lightweight-charts", async () => {
  const { lightweightChartsStub } = await import("../lib/test/lightweight-charts-stub");
  return lightweightChartsStub();
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import { PortfolioChart } from "./portfolio-chart";
import { getPortfolioHistory } from "../lib/api";
import * as lwc from "lightweight-charts";
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
  it("reports the day under the crosshair, and reads its figures", () => {
    // The chart and the hero numeral are one instrument: this is the wire that
    // makes that true. Driven through the mocked `subscribeCrosshairMove`
    // handler, because lightweight-charts draws nothing in jsdom and there is
    // no canvas to move a real pointer over.
    const onScrub = vi.fn();
    renderWithClient(
      <PortfolioChart
        initialHistory={history}
        displayCurrency={null}
        todayChange={null}
        onScrub={onScrub}
      />,
      makeTestQueryClient(),
    );

    const createChart = lwc.createChart as unknown as ReturnType<typeof vi.fn>;
    const chart = createChart.mock.results.at(-1)!.value as {
      subscribeCrosshairMove: ReturnType<typeof vi.fn>;
    };
    const onCrosshair = chart.subscribeCrosshairMove.mock.calls.at(-1)![0] as (p: unknown) => void;

    // The first fixture day: money in 9,000 against a value of 10,000.
    act(() => onCrosshair({ time: "2026-01-01" }));
    expect(onScrub).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-01-01" }));
    expect(screen.getByText("$9,000.00")).toBeInTheDocument();

    // Off the plot: `time` is undefined, and the strip returns to the last day.
    act(() => onCrosshair({ time: undefined }));
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("$9,500.00")).toBeInTheDocument();
  });

  it("labels the line money in, never invested", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    // A stat label since 2026-09-10, not a toggle: the line is structural now,
    // because the shaded gain between it and the value line has no floor
    // without it. The wording rule it guards is unchanged.
    expect(screen.getByText(/money in/i)).toBeInTheDocument();
    expect(screen.queryByText(/^invested$/i)).not.toBeInTheDocument();
  });

  it("explains why money in can sit below the cost of current holdings", () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    expect(screen.getByTitle(/contributions minus withdrawals/i)).toBeInTheDocument();
  });

  // A regression guard, not a coverage box. Benchmark overlays were removed
  // from this chart on 2026-09-10 because they could not be drawn honestly
  // here: this series is absolute portfolio value, so it steps up when you
  // deposit, while a benchmark can only be a percentage on its own
  // independently-autoscaled axis. One line moved with cash flows, the other
  // structurally could not, and a book with steady inflows drew itself above
  // the index for the act of depositing money.
  //
  // If someone re-adds a toggle here, this fails and they have to read why.
  // The honest version is an index-equivalent line in currency (same flows,
  // same dates, invested into the index) — that is a different series, and it
  // would not be labelled with a bare index name, so this stays valid.
  it("offers no benchmark overlay, because value and an index share no scale", async () => {
    renderWithClient(
      <PortfolioChart initialHistory={history} displayCurrency={null} todayChange={null} />,
      makeTestQueryClient(),
    );
    // "Money in" proves the readout rendered at all, so the absences below are
    // evidence rather than a query that ran before anything mounted.
    expect(await screen.findByText(/Money in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /S&P 500/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /MSCI World/ })).not.toBeInTheDocument();
  });
});
