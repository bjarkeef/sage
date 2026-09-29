import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewStatStrip } from "./stat-strip";

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
