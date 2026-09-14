import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewHero } from "./hero";
import { allByMoney, getByMoney } from "../../lib/test/by-money";

const income = { amount: "42318.40", currency: "USD" };
const trailing = { amount: "39178.40", currency: "USD" };
const payment = {
  date: "2026-03-14",
  amount: "612.50",
  currency: "USD",
  symbol: "KO",
  certainty: "paid" as const,
};

describe("OverviewHero", () => {
  it("leads with forward income, not net worth", () => {
    render(<OverviewHero income={income} trailing={trailing} taxRate={null} paymentsAhead={18} />);
    expect(getByMoney("$42,318.40")).toBeInTheDocument();
    expect(screen.getByText("Income · next twelve months")).toBeInTheDocument();
    expect(screen.getByText("18 payments ahead")).toBeInTheDocument();
  });

  it("nets the figure by the dividend tax rate", () => {
    // The bars below are netted too; a gross headline over net bars is the
    // same figure read two ways on one screen.
    render(<OverviewHero income={income} trailing={null} taxRate={25} paymentsAhead={0} />);
    expect(getByMoney("$31,738.80")).toBeInTheDocument();
  });

  it("compares against the trailing year, netted by the same rate", () => {
    render(<OverviewHero income={income} trailing={trailing} taxRate={null} paymentsAhead={4} />);
    expect(screen.getByText("on last year")).toBeInTheDocument();
    // Delta renders its sign (signDisplay: "exceptZero").
    expect(getByMoney("+$3,140.00")).toBeInTheDocument();
  });

  it("draws no comparison on a book with no year behind it", () => {
    // Measured against zero, every new book is up infinity percent.
    render(<OverviewHero income={income} trailing={null} taxRate={null} paymentsAhead={4} />);
    expect(screen.queryByText("on last year")).not.toBeInTheDocument();
  });

  it("replaces the summary with the payment under the pointer", () => {
    render(
      <OverviewHero
        income={income}
        trailing={trailing}
        taxRate={null}
        paymentsAhead={18}
        hovered={payment}
      />,
    );
    expect(screen.getByText("KO")).toBeInTheDocument();
    expect(getByMoney("$612.50")).toBeInTheDocument();
    expect(screen.getByText(/Mar 14, 2026 · paid/)).toBeInTheDocument();
    // "18 payments ahead" is a claim about the forward window; beside a March
    // mark it reads as a caption for the mark.
    expect(screen.queryByText("18 payments ahead")).not.toBeInTheDocument();
    expect(allByMoney("$42,318.40")).toHaveLength(1);
  });

  it("falls back to a dash when there is no income figure at all", () => {
    render(<OverviewHero income={null} trailing={null} taxRate={null} paymentsAhead={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
