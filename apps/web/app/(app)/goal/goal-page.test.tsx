import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import GoalPage from "./page";
import type { GoalViewDTO } from "../../../lib/types";

const emptyView: GoalViewDTO = {
  goal: null,
  defaults: {
    currency: "DKK",
    divYieldPct: "2.92",
    divGrowthPct: "4.25",
    annualReturnPct: "12.84",
    monthlyContribution: "277.39",
    inflationPct: "2.5",
    dividendTaxRate: null,
  },
  result: null,
};

describe("GoalPage", () => {
  it("renders the form with defaults and a placeholder when no goal is set", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.goal(), emptyView);
    renderWithClient(<GoalPage />, qc);
    // "Goal" also appears as the GoalForm's mode-field label, so scope to the
    // page heading rendered by PageHeader to avoid an ambiguous getByText match.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Goal" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /save and calculate/i })).toBeInTheDocument();
    expect(screen.getByText(/set a goal to see your path/i)).toBeInTheDocument();
  });

  it("shows the settings prompt when the portfolio is multi-currency without a display currency", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.goal(), {
      goal: null,
      defaults: null,
      result: null,
      reason: "multi-currency portfolio — set a display currency in Settings",
      reasonCode: "multi_currency",
    } satisfies GoalViewDTO);
    renderWithClient(<GoalPage />, qc);
    await waitFor(() => expect(screen.getByText(/set a display currency/i)).toBeInTheDocument());
  });

  /** An empty portfolio and a multi-currency one both arrive with no defaults,
   *  and they need opposite advice. This branch printed the API's `reason`
   *  verbatim — lowercase and mid-sentence — beneath an "Open Settings" button,
   *  which is the multi-currency remedy handed to someone who simply has no
   *  holdings. */
  it("offers import, not Settings, when the portfolio is empty", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.goal(), {
      goal: null,
      defaults: null,
      result: null,
      reason: "no positions yet — add transactions or import a portfolio first",
      reasonCode: "no_positions",
    } satisfies GoalViewDTO);

    renderWithClient(<GoalPage />, qc);

    expect(await screen.findByText(/nothing to project from yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import transactions/ })).toHaveAttribute(
      "href",
      "/import",
    );
    expect(screen.queryByText(/Open Settings/)).not.toBeInTheDocument();
    // The raw API string must not reach the page.
    expect(screen.queryByText(/no positions yet/)).not.toBeInTheDocument();
  });

  // Not a legal notice — the same habit as flagging short price history or
  // stale FX, on the only page in Sage that draws the future rather than
  // reporting the past, where a curve reads as a promise unless it says
  // otherwise. It tells the reader how to read the chart, so it belongs here
  // and not in the README.
  it("says the projection is not a forecast once a result is shown", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.goal(), {
      goal: {
        type: "value",
        amount: "1000000",
        currency: "DKK",
        targetYear: 2046,
        monthlyContribution: "5000",
        contributionIncrease: "none",
        contributionIncreasePct: null,
        divYieldPct: "3",
        divGrowthPct: "4",
        annualReturnPct: "7",
        adjustGoalForInflation: false,
        inflationPct: "2.5",
        reinvestDividends: true,
        suggestAlternative: false,
      },
      defaults: emptyView.defaults,
      result: {
        netMode: false,
        currency: "DKK",
        progressPct: 12.5,
        currentMetric: "125000",
        goalAtTargetYear: "1000000",
        targetYear: 2046,
        achievedInYears: null,
        achievedYear: null,
        scenarios: [
          {
            id: "portfolio",
            params: {
              divYieldPct: "3",
              divGrowthPct: "4",
              annualReturnPct: "7",
              monthlyContribution: "5000",
              contributionGrowthPct: "0",
              reinvestDividends: true,
            },
            achievedInYears: null,
            achievedYear: null,
            rows: [
              {
                yearOffset: 0,
                year: 2026,
                goal: "1000000",
                annualContribution: "60000",
                monthlyContribution: "5000",
                value: "125000",
                income: "3750",
                achieved: false,
              },
            ],
          },
        ],
      },
    } satisfies GoalViewDTO);
    renderWithClient(<GoalPage />, qc);

    await waitFor(() =>
      expect(screen.getByText(/a projection, not a forecast/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/guarantees nothing/i)).toBeInTheDocument();
  });
});
