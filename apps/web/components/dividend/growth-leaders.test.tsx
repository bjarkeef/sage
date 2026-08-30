import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GrowthLeaders, topGrowth } from "./growth-leaders";
import type { DividendPerHoldingDTO } from "../../lib/types";

function h(overrides: Partial<DividendPerHoldingDTO> & { symbol: string }): DividendPerHoldingDTO {
  return {
    forwardAnnualIncome: { amount: "10", currency: "USD" },
    incomeShare: 0.1,
    cagr5y: null,
    trend: "unknown",
    ...overrides,
  };
}

describe("topGrowth", () => {
  it("sorts descending by CAGR, skips holdings without one, and converts to %", () => {
    const rows = topGrowth([
      h({ symbol: "DUOMO", cagr5y: "0.24" }),
      h({ symbol: "SEINE", cagr5y: "-0.04" }),
      h({ symbol: "NOCAGR", cagr5y: null }),
      h({ symbol: "THAMES", cagr5y: "0.23" }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["DUOMO", "THAMES", "SEINE"]);
    expect(rows[0]).toEqual({ symbol: "DUOMO", pct: 24 });
  });

  it("caps at the 8 fastest growers", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      h({ symbol: `S${i}`, cagr5y: `${0.2 - i * 0.01}` }),
    );
    const rows = topGrowth(many);
    expect(rows).toHaveLength(8);
    expect(rows[0]!.symbol).toBe("S0");
    expect(rows.some((r) => r.symbol === "S11")).toBe(false);
  });
});

// The bars are a Recharts SVG (0×0 under jsdom), so the component test checks
// the card chrome + empty state; the chart is verified visually.
describe("GrowthLeaders", () => {
  it("renders the card when a holding has a CAGR", () => {
    render(<GrowthLeaders perHolding={[h({ symbol: "UP", cagr5y: "0.10" })]} />);
    expect(screen.getByText("Dividend growth")).toBeInTheDocument();
  });

  it("renders nothing when no holding has a CAGR", () => {
    const { container } = render(<GrowthLeaders perHolding={[h({ symbol: "A", cagr5y: null })]} />);
    expect(container.firstChild).toBeNull();
  });
});
