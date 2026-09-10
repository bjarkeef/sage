import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyRhythm } from "./monthly-rhythm";

// Bars are a Recharts SVG that needs a measured size (jsdom is 0×0), so these
// assert the card chrome + empty state; the chart is verified visually.
describe("MonthlyRhythm", () => {
  it("renders the card when there is data", () => {
    render(
      <MonthlyRhythm
        rows={[
          { month: "2026-05", amount: 40 },
          { month: "2026-06", amount: 100 },
        ]}
        currency="DKK"
      />,
    );
    expect(screen.getByText("Monthly rhythm")).toBeInTheDocument();
    expect(screen.getByText(/last 12/)).toBeInTheDocument();
  });

  it("renders nothing when there is no data", () => {
    const { container } = render(<MonthlyRhythm rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // Recharts never lays out its SVG under jsdom, so the page-level invariant
  // test (analytics.test.tsx) cannot see this card's money figures and so
  // cannot confirm its BasisChip either — this is the real coverage for that
  // gap. `CardTitle` and `BasisChip` are plain DOM, so it sidesteps the
  // Recharts/jsdom limitation entirely rather than working around it.
  it("carries a basis marker in its title row", () => {
    render(<MonthlyRhythm rows={[{ month: "2026-05", amount: 40 }]} currency="DKK" taxed />);
    expect(screen.getByText("After tax")).toBeInTheDocument();
  });

  it("says before tax when no rate is configured", () => {
    render(
      <MonthlyRhythm rows={[{ month: "2026-05", amount: 40 }]} currency="DKK" taxed={false} />,
    );
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });
});
