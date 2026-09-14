import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IncomeStream } from "./income-stream";
import type { IncomeStreamPointDTO } from "../../lib/types";

/** The global stub in vitest.setup.ts never fires its callback, so the chart
 *  measures 0 and draws nothing. Swap in one that reports a real width, since
 *  everything worth asserting here is geometry. */
const realRO = globalThis.ResizeObserver;
beforeAll(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb([{ contentRect: { width: 1000 } } as ResizeObserverEntry], this);
      void target;
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO;
});
afterAll(() => {
  globalThis.ResizeObserver = realRO;
});

const TODAY = "2026-09-14";

function pt(o: Partial<IncomeStreamPointDTO> & { date: string }): IncomeStreamPointDTO {
  return {
    amount: "100.00",
    currency: "USD",
    symbol: "O",
    certainty: "paid",
    ...o,
  };
}

const POINTS = [
  pt({ date: "2026-03-10", symbol: "KO", amount: "400.00", certainty: "paid" }),
  pt({ date: "2026-09-20", symbol: "PG", amount: "200.00", certainty: "confirmed" }),
  pt({ date: "2027-06-01", symbol: "JNJ", amount: "100.00", certainty: "estimated" }),
];

describe("IncomeStream", () => {
  it("draws one mark per payment, toned by how certain it is", () => {
    const { container } = render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} />);
    const bars = container.querySelectorAll("rect[rx]");

    expect(bars).toHaveLength(3);
    expect([...bars].map((b) => b.getAttribute("fill"))).toEqual([
      "var(--certainty-paid)",
      "var(--certainty-confirmed)",
      "var(--certainty-estimated)",
    ]);
  });

  it("scales height by amount, so the biggest payment is the tallest mark", () => {
    const { container } = render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} />);
    const heights = [...container.querySelectorAll("rect[rx]")].map((b) =>
      Number(b.getAttribute("height")),
    );

    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
  });

  it("places today's rule between the paid marks and the forecast ones", () => {
    const { container } = render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} />);
    const bars = [...container.querySelectorAll("rect[rx]")].map((b) =>
      Number(b.getAttribute("x")),
    );
    // The one full-height vertical rule; the axis line is horizontal.
    const rule = [...container.querySelectorAll("line")].find(
      (l) =>
        l.getAttribute("x1") === l.getAttribute("x2") &&
        l.getAttribute("stroke") === "var(--foreground)",
    )!;
    const ruleX = Number(rule.getAttribute("x1"));

    expect(bars[0]).toBeLessThan(ruleX);
    expect(bars[1]).toBeGreaterThan(ruleX);
  });

  it("reports the payment under the pointer so the figure above can read it", () => {
    const onHover = vi.fn();
    const { container } = render(
      <IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} onHover={onHover} />,
    );

    fireEvent.pointerEnter(container.querySelectorAll("rect[rx]")[1]!);
    expect(onHover).toHaveBeenLastCalledWith(POINTS[1]);

    fireEvent.pointerLeave(container.querySelector("svg")!);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("nets the marks by the tax rate, matching the figure above them", () => {
    // A gross chart under a net headline is the same figure read two ways on
    // one screen — the duplicate-figure trap this page has hit before. Netting
    // scales every bar equally, so it shows up in the accessible description
    // rather than in relative heights.
    const { container } = render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={50} />);
    const gross = render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} />);

    const netH = [...container.querySelectorAll("rect[rx]")].map((b) => b.getAttribute("height"));
    const grossH = [...gross.container.querySelectorAll("rect[rx]")].map((b) =>
      b.getAttribute("height"),
    );
    // Heights are relative to the tallest bar, so the shape is identical —
    // what must not happen is the netting throwing or collapsing the chart.
    expect(netH).toEqual(grossH);
    expect(netH.every((h) => Number(h) > 0)).toBe(true);
  });

  it("renders nothing rather than an empty axis when there are no payments", () => {
    const { container } = render(<IncomeStream points={[]} todayISO={TODAY} taxRate={null} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("names the window and the payment count for a screen reader", () => {
    render(<IncomeStream points={POINTS} todayISO={TODAY} taxRate={null} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("3 payments");
  });
});
