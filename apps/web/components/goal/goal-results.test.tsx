import { describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GoalProgressHero } from "./goal-progress-hero";
import { GoalCallouts } from "./goal-callouts";
import { GoalResultsTable } from "./goal-results-table";
import type { GoalResultDTO, GoalYearRowDTO } from "../../lib/types";

const year = new Date().getFullYear();

function row(offset: number, over: Partial<GoalYearRowDTO> = {}): GoalYearRowDTO {
  return {
    yearOffset: offset,
    year: year + offset,
    goal: "120000.00",
    annualContribution: "120000.00",
    monthlyContribution: "10000.00",
    value: "150000.00",
    income: String(4000 + offset * 9000),
    achieved: false,
    ...over,
  };
}

function result(over: Partial<GoalResultDTO> = {}): GoalResultDTO {
  return {
    netMode: false,
    currency: "DKK",
    progressPct: 2.3,
    currentMetric: "3841.18",
    goalAtTargetYear: "165421.33",
    targetYear: year + 13,
    achievedInYears: 21,
    achievedYear: year + 21,
    scenarios: [
      {
        id: "portfolio",
        params: {
          divYieldPct: "2.92",
          divGrowthPct: "4.25",
          annualReturnPct: "0.00",
          monthlyContribution: "10000.00",
          contributionGrowthPct: "2.50",
          reinvestDividends: true,
        },
        achievedInYears: 21,
        achievedYear: year + 21,
        rows: [row(0), row(1), row(21, { achieved: true })],
      },
      {
        id: "alternative",
        params: {
          divYieldPct: "2.92",
          divGrowthPct: "4.25",
          annualReturnPct: "0.00",
          monthlyContribution: "10000.00",
          contributionGrowthPct: "11.50",
          reinvestDividends: true,
        },
        changed: [{ key: "contributionGrowthPct", from: "2.50", to: "11.50" }],
        achievedInYears: 13,
        achievedYear: year + 13,
        rows: [row(0), row(1), row(13, { achieved: true })],
      },
    ],
    ...over,
  };
}

describe("GoalProgressHero", () => {
  it("shows progress, current/target and achievable year", () => {
    render(<GoalProgressHero result={result()} mode="passive_income" />);
    expect(screen.getByText(/2(\.3)?%/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`in 21 years`, "i"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`by ${year + 21}`, "i"))).toBeInTheDocument();
  });

  it("labels income after tax in net mode", () => {
    render(<GoalProgressHero result={result({ netMode: true })} mode="passive_income" />);
    fireEvent.click(screen.getByRole("button", { name: "About this figure" }));
    expect(screen.getByText(/after your configured dividend tax rate/i)).toBeInTheDocument();
  });

  it("labels the metric as portfolio value in value mode", () => {
    render(<GoalProgressHero result={result()} mode="value" />);
    expect(screen.getByText(/portfolio value/i)).toBeInTheDocument();
  });

  it("says not reachable when never achieved", () => {
    render(
      <GoalProgressHero
        result={result({ achievedInYears: null, achievedYear: null })}
        mode="passive_income"
      />,
    );
    expect(screen.getByText(/not reachable within 50 years/i)).toBeInTheDocument();
  });
});

describe("GoalCallouts", () => {
  it("shows a risk callout when achieved later than target, plus the alternative insight", () => {
    render(<GoalCallouts result={result()} />);
    // 21 achievable vs 13 target → 8 years later
    expect(screen.getByText(/8 years later/i)).toBeInTheDocument();
    expect(screen.getByText(/alternative scenario/i)).toBeInTheDocument();
    // the changed knob is surfaced with from → to in the insight paragraph
    expect(screen.getByText(/2\.50?%\s*→\s*11\.50?%/)).toBeInTheDocument();
  });

  it("shows on-track when achieved by target year", () => {
    render(
      <GoalCallouts
        result={result({
          achievedInYears: 10,
          achievedYear: year + 10,
          scenarios: [result().scenarios[0]!],
        })}
      />,
    );
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
  });
});

describe("GoalResultsTable", () => {
  it("renders year rows with goal, contributions and both scenarios", () => {
    render(<GoalResultsTable result={result()} mode="passive_income" />);
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(screen.getAllByText(String(year + 1)).length).toBeGreaterThan(0);
    expect(screen.getByText(/portfolio/i)).toBeInTheDocument();
    expect(screen.getByText(/alternative/i)).toBeInTheDocument();
    // achievement cell marker
    expect(screen.getAllByText(/🎉/).length).toBeGreaterThan(0);
  });

  it("labels the income column before tax when gross, after tax when net", () => {
    render(<GoalResultsTable result={result()} mode="passive_income" />);
    expect(screen.getByText(/income before tax/i)).toBeInTheDocument();
    cleanup();
    render(<GoalResultsTable result={result({ netMode: true })} mode="passive_income" />);
    expect(screen.getByText(/income after tax/i)).toBeInTheDocument();
  });

  it("omits tax wording entirely in value mode", () => {
    render(<GoalResultsTable result={result()} mode="value" />);
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument();
  });

  it("renders column headers and each row's share of the goal", () => {
    render(<GoalResultsTable result={result()} mode="passive_income" />);
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    // The gain that motivates this change: two-line cells have room for the
    // share of the goal, which the flat table had nowhere to put. `year + 1`
    // (not a literal year) so this doesn't rot the day the calendar turns --
    // hardcoded fixture years have gone stale here before.
    expect(screen.getByTestId(`goal-share-${year + 1}`)).toHaveTextContent("%");
  });
});
