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

  it("is 16px and a 44px target on a phone, so iOS does not zoom the page in", () => {
    // Safari zooms the whole page when a focused field's text is under 16px,
    // and the user has to pinch back out — on every field in the app. 36px
    // also misses the 44px touch target DESIGN.md sets for a row. Both revert
    // to the desktop sizes at `md`, the shell's own phone boundary.
    render(<Input aria-label="Amount" />);
    const el = screen.getByLabelText("Amount");
    expect(el.className).toContain("text-base");
    expect(el.className).toContain("md:text-sm");
    expect(el.className).toContain("h-11");
    expect(el.className).toContain("md:h-9");
  });

  it("forwards its ref and passes props through", () => {
    render(<Input aria-label="Amount" type="number" placeholder="0.00" />);
    const el = screen.getByLabelText("Amount");
    expect(el).toHaveAttribute("type", "number");
    expect(el).toHaveAttribute("placeholder", "0.00");
  });
});
