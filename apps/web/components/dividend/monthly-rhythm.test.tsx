import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyRhythm } from "./monthly-rhythm";

// The chart used to be a Recharts SVG, which never lays out under jsdom, so
// these could only assert the card chrome. It is now a hand-drawn ring, so the
// geometry is testable — which matters more here than it usually would, because
// a wedge's ANGLE carries its month.
//
// Always scope to the ring rather than querying the card: `BasisChip` renders a
// lucide icon, whose <path> elements are indistinguishable from wedges to a
// bare `querySelectorAll("path")`.
const ring = (c: HTMLElement) => c.querySelector('svg[role="img"]')!;
const wedges = (c: HTMLElement) => [...ring(c).querySelectorAll("path")];
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

  it("draws twelve wedges even when most months paid nothing", () => {
    // `buildMonthlyRhythm` omits empty months. Skipping them here would rotate
    // every later month into the wrong slot, and an empty August is the single
    // most informative wedge on a lumpy book.
    const { container } = render(
      <MonthlyRhythm rows={[{ month: "2026-06", amount: 100 }]} currency="DKK" />,
    );
    expect(wedges(container)).toHaveLength(12);
  });

  it("ends the ring at the latest month and walks back twelve", () => {
    const { container } = render(
      <MonthlyRhythm
        rows={[
          { month: "2026-03", amount: 10 },
          { month: "2026-06", amount: 100 },
        ]}
        currency="DKK"
      />,
    );
    const titles = wedges(container).map((p) => p.querySelector("title")?.textContent ?? "");

    expect(titles[0]).toMatch(/^July 2025/);
    expect(titles[11]).toMatch(/^June 2026/);
    // The month that paid nothing still gets its slot, at zero.
    expect(titles.find((t) => t.startsWith("August 2025"))).toMatch(/0\.00$/);
  });

  it("fills with the area token, not the text one", () => {
    // Gold has two roles. `--income` is tuned for 4.5:1 as text, which on a
    // light card makes it a brown; the bar chart this replaced filled with it.
    const { container } = render(
      <MonthlyRhythm rows={[{ month: "2026-06", amount: 100 }]} currency="DKK" />,
    );
    const fills = new Set(wedges(container).map((p) => p.getAttribute("fill")));

    expect([...fills]).toEqual(["var(--income-fill)"]);
  });

  it("marks what an even year would pay, so lumpy is visible rather than inferred", () => {
    const { container } = render(
      <MonthlyRhythm
        rows={[
          { month: "2026-05", amount: 60 },
          { month: "2026-06", amount: 60 },
        ]}
        currency="DKK"
      />,
    );
    // 120 over twelve months.
    expect(screen.getByText(/DKK 10\.00 a month, if the year paid evenly/)).toBeInTheDocument();
    expect(container.querySelector("circle[stroke-dasharray]")).not.toBeNull();
  });

  it("scales every wedge against the biggest month", () => {
    const { container } = render(
      <MonthlyRhythm
        rows={[
          { month: "2026-05", amount: 50 },
          { month: "2026-06", amount: 100 },
        ]}
        currency="DKK"
      />,
    );
    // A zero month collapses to the inner radius; the biggest reaches the rim.
    const lengths = wedges(container).map((p) => (p.getAttribute("d") ?? "").length);
    expect(new Set(lengths).size).toBeGreaterThan(1);
  });

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
