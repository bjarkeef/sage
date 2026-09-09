import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { YieldByHolding, topYields } from "./yield-by-holding";

describe("topYields", () => {
  it("caps the list at the 8 highest yielders (rows arrive pre-sorted desc)", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      symbol: `S${i}`,
      currentYield: 12 - i,
    }));
    const top = topYields(rows);
    expect(top).toHaveLength(8);
    expect(top[0]!.symbol).toBe("S0");
    expect(top.at(-1)!.symbol).toBe("S7");
  });

  it("returns everything when there are 8 or fewer", () => {
    const rows = [{ symbol: "A", currentYield: 5 }];
    expect(topYields(rows)).toHaveLength(1);
  });
});

// The bars are a Recharts SVG (0×0 under jsdom), so the component test checks
// the card chrome + empty state; the chart is verified visually.
describe("YieldByHolding", () => {
  it("renders the card when there are rows", () => {
    render(<YieldByHolding rows={[{ symbol: "HIYLD", currentYield: 9.1 }]} />);
    expect(screen.getByText("Yield by holding")).toBeInTheDocument();
  });

  it("renders nothing when there are no rows", () => {
    const { container } = render(<YieldByHolding rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // Recharts never lays out its SVG under jsdom, and this card never renders
  // a currency symbol at all (percentage only), so the page-level invariant
  // test (analytics.test.tsx) cannot see this card's figure and so cannot
  // confirm its BasisChip either — this is the real coverage for that gap.
  // `CardTitle` and `BasisChip` are plain DOM, so it sidesteps the
  // Recharts/jsdom limitation entirely rather than working around it.
  it("carries a basis marker in its title row", () => {
    render(<YieldByHolding rows={[{ symbol: "HIYLD", currentYield: 9.1 }]} taxed />);
    expect(screen.getByText("After tax")).toBeInTheDocument();
  });

  it("says before tax when no rate is configured", () => {
    render(<YieldByHolding rows={[{ symbol: "HIYLD", currentYield: 9.1 }]} taxed={false} />);
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });
});
