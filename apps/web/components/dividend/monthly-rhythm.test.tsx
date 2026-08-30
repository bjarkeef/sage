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
});
