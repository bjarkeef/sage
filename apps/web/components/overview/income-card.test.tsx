import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { IncomeCard } from "./income-card";

const income = {
  received: { amount: "120", currency: "DKK" },
  projected: { amount: "300", currency: "DKK" },
};

describe("IncomeCard", () => {
  it("headlines this month's full total (received + upcoming), before tax by default", () => {
    const { container } = render(
      <IncomeCard
        income={income}
        annualIncome={{ amount: "3600", currency: "DKK" }}
        taxRate={null}
      />,
    );
    expect(container.textContent).toContain("Before tax");
    // headline is the full month total (300), not the received slice (120)
    expect(container.textContent).toMatch(/300/);
    expect(container.textContent).toContain("received so far");
    expect(container.textContent).toMatch(/120/);
  });

  it("nets every figure and labels it after tax when a rate is set", () => {
    const { container } = render(
      <IncomeCard
        income={income}
        annualIncome={{ amount: "3600", currency: "DKK" }}
        taxRate={35}
      />,
    );
    expect(container.textContent).toContain("After tax");
    expect(container.textContent).toMatch(/195/); // 300 * 0.65 headline
    expect(container.textContent).toMatch(/78/); // 120 * 0.65 received so far
  });
});
