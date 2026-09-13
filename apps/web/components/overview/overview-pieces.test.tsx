import { render, screen } from "@testing-library/react";
import { getByMoney } from "../../lib/test/by-money";
import { describe, expect, it } from "vitest";
import { OverviewHero } from "./hero";
import { OverviewStatStrip } from "./stat-strip";

describe("OverviewHero", () => {
  it("shows the value and a today delta", () => {
    render(
      <OverviewHero
        value={{ amount: "7451.39", currency: "USD" }}
        todayChange={{ amount: { amount: "-65.18", currency: "USD" }, percent: -0.87 }}
      />,
    );
    expect(getByMoney("$7,451.39")).toBeInTheDocument();
    expect(screen.getByText(/-0\.87%|−0\.87%/)).toBeInTheDocument();
  });
  it("omits the delta when todayChange is null", () => {
    render(<OverviewHero value={{ amount: "7451.39", currency: "USD" }} todayChange={null} />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

describe("OverviewStatStrip", () => {
  it("renders four labeled cells and dashes a null figure", () => {
    render(
      <OverviewStatStrip
        ytdPercent={16.15}
        income={{
          received: { amount: "5.42", currency: "USD" },
          projected: { amount: "5.42", currency: "USD" },
        }}
        annualIncome={{ amount: "92", currency: "USD" }}
        totalReturn={null}
        taxRate={null}
      />,
    );
    expect(screen.getByText("YTD return")).toBeInTheDocument();
    expect(screen.getByText("Vs cost")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // null totalReturn
  });
});
