import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomeTimeline } from "./income-timeline";

const points = [
  { year: 2024, received: 1000, projected: 0, total: 1000, isCurrentYear: false },
  { year: 2025, received: 1200, projected: 0, total: 1200, isCurrentYear: false },
  { year: 2026, received: 140, projected: 70, total: 210, isCurrentYear: true },
];

describe("IncomeTimeline", () => {
  it("renders the card with its legend", () => {
    render(<IncomeTimeline points={points} currency="DKK" />);
    // Exact strings, not /received/i: the card's subtitle also reads
    // "Received, and still expected this year", so a loose matcher finds two
    // elements and getByText throws.
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Still expected")).toBeInTheDocument();
  });

  // The chart stops at the current year on purpose. The line says so, and
  // points at the page that does answer the long-horizon question.
  it("says where the horizon ends and links to the goal page", () => {
    render(<IncomeTimeline points={points} currency="DKK" />);
    expect(screen.getByRole("link", { name: /goal/i })).toHaveAttribute("href", "/goal");
  });

  it("renders nothing when no income has ever been recorded", () => {
    const { container } = render(<IncomeTimeline points={[]} currency="DKK" />);
    expect(container.firstChild).toBeNull();
  });

  it("points at settings when income recording is off", () => {
    render(<IncomeTimeline points={[]} currency="DKK" incomeRecordingOff />);
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });
});
