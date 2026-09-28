import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithClient } from "../../../lib/test/render-with-client";
import { IncomeTape } from "./income-tape";
import type { IncomeStreamPointDTO } from "../../../lib/types";

// No goal in these tests: a pending query yields goalMark "none" without a fetch.
vi.mock("../../../lib/api", () => ({ getGoal: vi.fn(() => new Promise(() => {})) }));

const realRO = globalThis.ResizeObserver;
beforeAll(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe() {
      this.cb([{ contentRect: { width: 1096, height: 434 } } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO;
});
afterAll(() => {
  globalThis.ResizeObserver = realRO;
});

const TODAY = "2026-09-28";
const pt = (
  date: string,
  symbol: string,
  amount: string,
  certainty: IncomeStreamPointDTO["certainty"],
  headline: IncomeStreamPointDTO["headline"],
): IncomeStreamPointDTO => ({
  date,
  amount,
  currency: "DKK",
  symbol,
  certainty,
  headline,
});
const POINTS = [
  pt("2025-06-10", "KO", "90.00", "paid", null),
  pt("2026-06-12", "KO", "100.00", "paid", "trailing"),
  pt("2026-10-15", "O", "40.00", "confirmed", "forward"),
  pt("2027-06-11", "KO", "110.00", "estimated", "forward"),
];

function renderTape() {
  return renderWithClient(
    <IncomeTape
      points={POINTS}
      todayISO={TODAY}
      taxRate={0}
      currency="DKK"
      motionPref={false}
      names={new Map([["KO", "Coca-Cola"]])}
    />,
  );
}

describe("IncomeTape", () => {
  it("opens on Today: next 12 months from the headline-tagged points", async () => {
    renderTape();
    expect(await screen.findByText("Next 12 months")).toBeInTheDocument();
    expect(screen.getByText("150.00")).toBeInTheDocument(); // 40 + 110
    expect(screen.getByText("vs last 12 months")).toBeInTheDocument();
  });

  it("switches range from the control", async () => {
    renderTape();
    fireEvent.click(await screen.findByRole("radio", { name: "All time" }));
    expect(screen.getByRole("radio", { name: "All time" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("340.00")).toBeInTheDocument();
    expect(screen.queryByText(/^vs /)).not.toBeInTheDocument();
  });

  it("focuses a payer from its chip, and Esc clears it", async () => {
    renderTape();
    fireEvent.click(await screen.findByRole("button", { name: /^KO/ }));
    expect(screen.getByText("KO · Next 12 months")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola · pays once a year")).toBeInTheDocument();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();
  });

  it("leaves the vertical wheel to the page and pans on shift + wheel", async () => {
    renderTape();
    const stage = await screen.findByRole("group", { name: /income timeline/i });
    const vertical = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    stage.dispatchEvent(vertical);
    expect(vertical.defaultPrevented).toBe(false);
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();

    const shifted = new WheelEvent("wheel", {
      deltaY: 100,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => void stage.dispatchEvent(shifted));
    expect(shifted.defaultPrevented).toBe(true);
    expect(screen.getByText("In view")).toBeInTheDocument();
  });
});
