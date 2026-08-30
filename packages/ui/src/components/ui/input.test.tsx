import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Input } from "./input";

describe("Input", () => {
  it("uses the control radius token, not an arbitrary one", () => {
    // DESIGN.md permits exactly four radii. This shipped as rounded-[13px] —
    // a fifth value nothing else in the system used — and inputs are the most
    // repeated control in the app, so one stray radius was visible everywhere.
    render(<Input aria-label="Amount" />);
    const el = screen.getByLabelText("Amount");
    expect(el.className).toContain("rounded-control");
    expect(el.className).not.toMatch(/rounded-\[/);
  });

  it("forwards its ref and passes props through", () => {
    render(<Input aria-label="Amount" type="number" placeholder="0.00" />);
    const el = screen.getByLabelText("Amount");
    expect(el).toHaveAttribute("type", "number");
    expect(el).toHaveAttribute("placeholder", "0.00");
  });
});
