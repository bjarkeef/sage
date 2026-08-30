import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnnualIncomeCard, CashFlowCard } from "./kpi-cards";
import { YearSummary } from "./year-summary";

function assertNoChains(container: HTMLElement) {
  for (const el of container.querySelectorAll(".label-caps")) {
    expect(el.textContent).not.toContain("·");
  }
}

describe("no qualifier chains in caps eyebrows", () => {
  it("annual income card", () => {
    const { container } = render(
      <AnnualIncomeCard amount={{ amount: "100", currency: "DKK" }} yoyPct={8} payers={3} />,
    );
    assertNoChains(container);
  });

  it("cash flow card", () => {
    const { container } = render(
      <CashFlowCard monthly={{ amount: "10", currency: "DKK" }} upcoming={[]} />,
    );
    assertNoChains(container);
  });

  it("year summary", () => {
    const { container } = render(
      <YearSummary
        progress={{
          received: 100,
          expected: 20,
          total: 120,
          currency: "DKK",
          mixedCurrency: false,
        }}
        year={2026}
      />,
    );
    assertNoChains(container);
  });
});
