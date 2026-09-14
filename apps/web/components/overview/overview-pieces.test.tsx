import { render, screen } from "@testing-library/react";
import { getByMoney } from "../../lib/test/by-money";
import { describe, expect, it } from "vitest";
import { OverviewHero } from "./hero";
import { OverviewStatStrip } from "./stat-strip";

describe("OverviewHero", () => {
  it("shows the income figure and a year-on-year delta", () => {
    render(
      <OverviewHero
        income={{ amount: "7451.39", currency: "USD" }}
        trailing={{ amount: "7516.57", currency: "USD" }}
        taxRate={null}
        paymentsAhead={3}
      />,
    );
    expect(getByMoney("$7,451.39")).toBeInTheDocument();
    expect(screen.getByText("on last year")).toBeInTheDocument();
  });
  it("omits the count when nothing is ahead", () => {
    render(
      <OverviewHero
        income={{ amount: "7451.39", currency: "USD" }}
        trailing={null}
        taxRate={null}
        paymentsAhead={0}
      />,
    );
    expect(screen.queryByText(/payments? ahead/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Made since you started")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // null totalReturn
  });
});
