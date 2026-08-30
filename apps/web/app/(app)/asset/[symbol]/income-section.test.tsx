import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomeSection } from "./income-section";
import type { AssetIncomeDTO } from "../../../../lib/types";

const FULL: AssetIncomeDTO = {
  currentYield: 0.0412,
  yieldOnCost: 0.0585,
  annualDividend: { amount: "4.12", currency: "USD" },
  dividendGrowth5y: "0.087",
  nextExDate: "2026-08-14",
  payoutRatio: 0.55,
};

describe("IncomeSection", () => {
  it("renders current yield and yield on cost", () => {
    render(<IncomeSection income={FULL} taxRate={null} />);
    expect(screen.getByText("4.12%")).toBeInTheDocument();
    expect(screen.getByText(/yield on cost/i).textContent).toContain("5.85%");
  });

  it("names the yield without a tax qualifier", () => {
    render(<IncomeSection income={FULL} taxRate={null} />);
    expect(screen.getByText("Current yield")).toBeInTheDocument();
  });

  it("nets both yields when a tax rate is configured", () => {
    render(
      <IncomeSection income={{ ...FULL, currentYield: 0.04, yieldOnCost: 0.06 }} taxRate={35} />,
    );
    expect(screen.getByText("2.60%")).toBeInTheDocument(); // 4.00% * 0.65
    expect(screen.getByText(/yield on cost/i).textContent).toContain("3.90%"); // 6.00% * 0.65
  });

  it("labels the yield basis locally — 'Before tax' when no rate is set", () => {
    render(<IncomeSection income={FULL} taxRate={null} />);
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });

  it("labels the yield basis locally — 'After tax' when a rate is configured", () => {
    render(<IncomeSection income={FULL} taxRate={35} />);
    expect(screen.getByText("After tax")).toBeInTheDocument();
  });

  it("leaves the declared per-share dividend gross", () => {
    render(<IncomeSection income={FULL} taxRate={35} />);
    // "Annual / share" is the issuer's declared figure — netting it would make
    // Sage disagree with the announcement people cross-check against.
    expect(screen.getAllByText("$4.12").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an em dash for null payout ratio and next ex-date", () => {
    render(
      <IncomeSection income={{ ...FULL, payoutRatio: null, nextExDate: null }} taxRate={null} />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("renders nothing when there is no dividend data", () => {
    const { container } = render(
      <IncomeSection
        income={{
          currentYield: null,
          yieldOnCost: null,
          annualDividend: null,
          dividendGrowth5y: null,
          nextExDate: null,
          payoutRatio: null,
        }}
        taxRate={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
