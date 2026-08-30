import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { OverviewStatStrip } from "./stat-strip";

const income = {
  received: { amount: "120", currency: "DKK" },
  projected: { amount: "300", currency: "DKK" },
};

describe("OverviewStatStrip", () => {
  it("shows this month's full total, not the received slice", () => {
    const { container } = render(
      <OverviewStatStrip
        ytdPercent={8}
        income={income}
        annualIncome={{ amount: "3600", currency: "DKK" }}
        totalReturn={null}
        taxRate={null}
      />,
    );
    expect(container.textContent).toContain("Income this month");
    expect(container.textContent).toMatch(/300/);
    expect(container.textContent).toContain("received so far");
  });

  it("nets both income figures when a rate is set", () => {
    const { container } = render(
      <OverviewStatStrip
        ytdPercent={8}
        income={income}
        annualIncome={{ amount: "3600", currency: "DKK" }}
        totalReturn={null}
        taxRate={35}
      />,
    );
    expect(container.textContent).toMatch(/195/); // 300 * 0.65
    expect(container.textContent).toMatch(/2,340/); // 3600 * 0.65
    expect(container.textContent).toMatch(/78/); // 120 * 0.65 (received, netted)
  });

  it("carries no dot-separated qualifier chains", () => {
    const { container } = render(
      <OverviewStatStrip
        ytdPercent={8}
        income={income}
        annualIncome={{ amount: "3600", currency: "DKK" }}
        totalReturn={{ amount: { amount: "500", currency: "DKK" }, percent: 12 }}
        taxRate={null}
      />,
    );
    for (const el of container.querySelectorAll(".label-caps")) {
      expect(el.textContent).not.toContain("·");
    }
    expect(container.textContent).toContain("all-time");
    expect(container.textContent).not.toContain("· all-time");
  });
});
