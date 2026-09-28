import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YearRibbon } from "./year-ribbon";
import { yearStartDay } from "../../../lib/income-tape/points";

const realRO = globalThis.ResizeObserver;
beforeAll(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb([{ contentRect: { width: 900, height: 150 } } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO;
});
afterAll(() => {
  globalThis.ResizeObserver = realRO;
});

const t = (total: number) => ({ total, paid: total, confirmed: 0, estimated: 0, count: 1 });
const YEARS = [
  { year: 2024, totals: t(900), partial: true },
  { year: 2025, totals: t(5000), partial: false },
  { year: 2026, totals: t(6000), partial: false },
];
const inView: [number, number] = [yearStartDay(2026), yearStartDay(2027)];

describe("YearRibbon", () => {
  it("shows each year's total, marks partial years and gives no change beside them", () => {
    render(
      <YearRibbon
        years={YEARS}
        inView={inView}
        selectedYear={null}
        goal={{ kind: "none" }}
        onPickYear={() => {}}
      />,
    );
    expect(screen.getByText("2024*")).toBeInTheDocument();
    expect(screen.getByText("+20.0%")).toBeInTheDocument(); // 2026 on 2025
    expect(screen.queryByText("+455.6%")).not.toBeInTheDocument(); // 2025 on partial 2024
  });

  it("jumps to a year when clicked", () => {
    const onPickYear = vi.fn();
    render(
      <YearRibbon
        years={YEARS}
        inView={inView}
        selectedYear={null}
        goal={{ kind: "none" }}
        onPickYear={onPickYear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /2025/ }));
    expect(onPickYear).toHaveBeenCalledWith(2025);
  });

  it("draws the goal line, the caption, or nothing", () => {
    const { rerender, container } = render(
      <YearRibbon
        years={YEARS}
        inView={inView}
        selectedYear={null}
        goal={{ kind: "line", amount: 7000, label: "GOAL DKK 7,000" }}
        onPickYear={() => {}}
      />,
    );
    expect(screen.getByText("GOAL DKK 7,000")).toBeInTheDocument();
    expect(container.querySelector("line[data-goal]")).not.toBeNull();

    rerender(
      <YearRibbon
        years={YEARS}
        inView={inView}
        selectedYear={null}
        goal={{ kind: "caption", text: "Goal: DKK 200,000 a year by 2041 — 2.6% of it this year" }}
        onPickYear={() => {}}
      />,
    );
    expect(screen.getByText(/Goal: DKK 200,000/)).toBeInTheDocument();
    expect(container.querySelector("line[data-goal]")).toBeNull();

    rerender(
      <YearRibbon
        years={YEARS}
        inView={inView}
        selectedYear={null}
        goal={{ kind: "none" }}
        onPickYear={() => {}}
      />,
    );
    expect(screen.queryByText(/goal/i)).not.toBeInTheDocument();
  });
});
