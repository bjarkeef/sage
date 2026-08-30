import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalProjectionChart, buildChartData, formatAxisValue } from "./goal-projection-chart";
import type { GoalScenarioDTO, GoalYearRowDTO } from "../../lib/types";

const year = new Date().getFullYear();
function row(offset: number, income: string): GoalYearRowDTO {
  return {
    yearOffset: offset,
    year: year + offset,
    goal: "120000.00",
    annualContribution: "120000.00",
    monthlyContribution: "10000.00",
    value: "150000.00",
    income,
    achieved: false,
  };
}
const portfolio: GoalScenarioDTO = {
  id: "portfolio",
  params: {
    divYieldPct: "2.92",
    divGrowthPct: "4.25",
    annualReturnPct: "0",
    monthlyContribution: "10000",
    contributionGrowthPct: "2.5",
    reinvestDividends: true,
  },
  achievedInYears: null,
  achievedYear: null,
  rows: [row(0, "3841"), row(1, "7704"), row(2, "11933")],
};

describe("buildChartData", () => {
  it("merges scenarios + goal into per-year points keyed by calendar year", () => {
    const alt: GoalScenarioDTO = {
      ...portfolio,
      id: "alternative",
      rows: [row(0, "3841"), row(1, "8047"), row(2, "13036")],
    };
    const data = buildChartData([portfolio, alt], "passive_income");
    expect(data).toHaveLength(3);
    expect(data[1]).toMatchObject({
      year: year + 1,
      portfolio: 7704,
      alternative: 8047,
      goal: 120000,
    });
  });

  it("uses value as the metric in value mode", () => {
    const data = buildChartData([portfolio], "value");
    expect(data[0]!.portfolio).toBe(150000);
  });
});

describe("formatAxisValue", () => {
  it("abbreviates every tick once the axis maximum does", () => {
    // The defect: 1000 became "1k" while 750 stayed "750" on the same axis.
    expect(formatAxisValue(1000, 1000)).toBe("1.0k");
    expect(formatAxisValue(750, 1000)).toBe("0.75k");
  });

  it("leaves the baseline zero unscaled on an abbreviated axis", () => {
    // Recharts puts a zero tick on the baseline of nearly every axis, and
    // `0.0k` there reads as a rounding artefact rather than as a unit.
    expect(formatAxisValue(0, 120_000)).toBe("0");
    expect(formatAxisValue(0, 2_000_000)).toBe("0");
  });

  it("leaves a small axis unabbreviated throughout", () => {
    expect(formatAxisValue(750, 900)).toBe("750");
    expect(formatAxisValue(250, 900)).toBe("250");
  });
});

describe("GoalProjectionChart", () => {
  it("renders the card chrome (chart itself cannot render in jsdom)", () => {
    render(
      <GoalProjectionChart
        scenarios={[portfolio]}
        mode="passive_income"
        targetYear={year + 13}
        currency="DKK"
      />,
    );
    expect(screen.getByText(/projection/i)).toBeInTheDocument();
  });
});
