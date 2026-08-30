import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnualIncomeCard, CashFlowCard, YieldCard } from "./kpi-cards";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO;
  }
});

describe("dividend KPI cards", () => {
  it("AnnualIncomeCard shows grouped, tabular income", () => {
    render(
      <AnnualIncomeCard amount={{ amount: "3291", currency: "DKK" }} yoyPct={4.7} payers={23} />,
    );
    // grouped, not "3291"
    expect(screen.getByTestId("annual-income")).toHaveTextContent(/3[ ,]291/);
    expect(screen.getByText(/4\.7%/)).toBeInTheDocument();
  });
  it("YieldCard computes a net headline from gross x (1 - taxRate/100) when a tax rate is set", () => {
    render(<YieldCard gross={4.34} taxRate={35} onCost={2.89} />);
    // 4.34 * (1 - 0.35) = 2.821
    expect(screen.getByTestId("yield-net")).toHaveTextContent("2.82%");
    expect(screen.getByText("net")).toBeInTheDocument();
    expect(screen.getByText("4.34%")).toBeInTheDocument(); // before tax = gross
    expect(screen.getByText("2.89%")).toBeInTheDocument(); // on cost
  });

  it("YieldCard falls back to the gross headline (no phantom split) when no tax rate is set", () => {
    render(<YieldCard gross={4.34} taxRate={null} onCost={2.89} />);
    expect(screen.getByTestId("yield-net")).toHaveTextContent("4.34%");
    expect(screen.getByText("yield")).toBeInTheDocument();
    expect(screen.queryByText("Before tax")).not.toBeInTheDocument();
    expect(screen.getByText("2.89%")).toBeInTheDocument(); // on cost still shown
  });

  it("YieldCard shows — when gross yield isn't computable (e.g. mixed currencies)", () => {
    render(<YieldCard gross={null} taxRate={null} onCost={null} />);
    expect(screen.getByTestId("yield-net")).toHaveTextContent("—");
  });
  it("CashFlowCard shows monthly avg + up to 3 upcoming payments", () => {
    render(
      <CashFlowCard
        monthly={{ amount: "274", currency: "DKK" }}
        upcoming={[
          { symbol: "SVEAFAST", date: "Jul 24", amount: { amount: "235", currency: "DKK" } },
          { symbol: "FRANKA", date: "Aug 3", amount: { amount: "60", currency: "DKK" } },
        ]}
      />,
    );
    expect(screen.getByText("SVEAFAST")).toBeInTheDocument();
    expect(screen.getAllByTestId("upcoming-row")).toHaveLength(2);
  });

  it("AnnualIncomeCard exposes an info tooltip explaining the figure", () => {
    render(
      <AnnualIncomeCard amount={{ amount: "3291", currency: "DKK" }} yoyPct={4.7} payers={23} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "About this figure" }));
    expect(
      screen.getByText(/Forward 12-month dividend income across your holdings/),
    ).toBeInTheDocument();
  });

  it("YieldCard exposes an info tooltip explaining gross vs net", () => {
    render(<YieldCard gross={4.34} taxRate={35} onCost={2.89} />);
    fireEvent.click(screen.getByRole("button", { name: "About this figure" }));
    expect(screen.getByText(/Headline is forward yield/)).toBeInTheDocument();
  });

  it("CashFlowCard exposes an info tooltip explaining the figure", () => {
    render(<CashFlowCard monthly={{ amount: "274", currency: "DKK" }} upcoming={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "About this figure" }));
    expect(
      screen.getByText(/Average monthly dividend income over the next 12 months/),
    ).toBeInTheDocument();
  });

  it("annual income card names the figure without a tax qualifier", () => {
    const { container } = render(
      <AnnualIncomeCard amount={{ amount: "100", currency: "DKK" }} yoyPct={8.2} payers={12} />,
    );
    expect(container.textContent).toContain("Annual income");
    expect(container.textContent).not.toContain("before tax");
    expect(container.textContent).toContain("vs last 12m, 12 payers");
  });

  it("cash flow card names the figure without a tax qualifier", () => {
    const { container } = render(
      <CashFlowCard monthly={{ amount: "10", currency: "DKK" }} upcoming={[]} />,
    );
    expect(container.textContent).toContain("Cash flow");
    expect(container.textContent).not.toContain("before tax");
  });

  it("gives the three hero cards one shell treatment", () => {
    render(
      <>
        <AnnualIncomeCard amount={{ amount: "3291", currency: "DKK" }} yoyPct={4.7} payers={23} />
        <YieldCard gross={4.34} taxRate={35} onCost={2.89} />
        <CashFlowCard monthly={{ amount: "274", currency: "DKK" }} upcoming={[]} />
      </>,
    );
    const cards = screen.getAllByTestId(/^kpi-card-/);
    expect(cards).toHaveLength(3);
    // The three <Card> elements already pass the same className string, so
    // comparing className alone can't tell "has the overlay" from "doesn't"
    // -- and asserting the absence of a marker we add and delete in the same
    // step proves nothing once the element is gone. The real differentiator
    // is that only the income card used to mount an extra absolutely
    // positioned overlay div carrying an inline radial-gradient background;
    // none of the three should carry one now.
    for (const card of cards) {
      expect(card.querySelector('[style*="radial-gradient"]')).not.toBeInTheDocument();
    }
  });
});
