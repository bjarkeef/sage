import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { AnalystRatingsDTO } from "../../../../lib/types";
import { AnalystDetail } from "./analyst-ratings-section";

const usd = (amount: string) => ({ amount, currency: "USD" });

function ratings(over: Partial<AnalystRatingsDTO> = {}): AnalystRatingsDTO {
  return {
    consensusKey: "buy",
    distribution: { strongBuy: 6, buy: 23, hold: 14, sell: 2, strongSell: 2 },
    targets: { low: usd("215"), mean: usd("318.25"), high: usd("400"), median: null },
    // The provider's own price. Nothing on the page may read it.
    currentPrice: usd("320.67"),
    analystCount: 43,
    asOf: "2026-06-15T08:00:00.000Z",
    upgradeHistory: [
      {
        firm: "Example Securities",
        fromGrade: "Hold",
        toGrade: "Buy",
        action: "up",
        date: "2026-06-01T00:00:00.000Z",
      },
    ],
    ...over,
  };
}
const quote = { price: usd("300"), asOf: "2026-06-15" };

describe("AnalystDetail", () => {
  it("renders the spread, the targets and the rating changes", () => {
    render(<AnalystDetail ratings={ratings()} quote={quote} />);
    expect(screen.getByText("43 analysts")).toBeInTheDocument();
    expect(screen.getByText("$318.25")).toBeInTheDocument();
    expect(screen.getByText("Example Securities")).toBeInTheDocument();
    expect(screen.getByText("Hold → Buy")).toBeInTheDocument();
  });

  it("puts the HEADER price on the target track and measures upside from it — never the provider's own", () => {
    const { container } = render(<AnalystDetail ratings={ratings()} quote={quote} />);
    expect(screen.getByText("Today $300.00")).toBeInTheDocument();
    expect(container.textContent).not.toContain("320.67");
    expect(container.textContent).toMatch(/\+\$18\.25/);
    expect(container.textContent).toContain("(+6.08%)");
  });

  it("draws no track and no upside without a price", () => {
    render(<AnalystDetail ratings={ratings()} quote={null} />);
    expect(screen.queryByText(/^Today/)).not.toBeInTheDocument();
  });

  it("shows only the targets the provider sent, never a bare dash", () => {
    const { container, rerender } = render(
      <AnalystDetail
        ratings={ratings({
          targets: { low: null, mean: usd("318.25"), high: usd("400"), median: null },
        })}
        quote={quote}
      />,
    );
    expect(container.textContent).not.toContain("—");
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
    expect(screen.getByText("$318.25")).toBeInTheDocument();
    expect(screen.getByText("$400.00")).toBeInTheDocument();
    rerender(
      <AnalystDetail
        ratings={ratings({ targets: { low: null, mean: usd("318.25"), high: null, median: null } })}
        quote={quote}
      />,
    );
    expect(container.textContent).not.toContain("—");
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(screen.getByText("$318.25")).toBeInTheDocument();
  });
});
