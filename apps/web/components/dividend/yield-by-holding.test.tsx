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
});
