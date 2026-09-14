import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders an unchecked switch", () => {
    render(<Switch aria-label="Morning brief" />);
    const el = screen.getByRole("switch", { name: "Morning brief" });
    expect(el).toHaveAttribute("data-state", "unchecked");
    expect(el.className).toContain("bg-secondary");
  });

  // A switch is chrome, so "on" is a foreground pill, not a sage one — the
  // same treatment `Button`'s default variant uses, so the two read as one
  // kind of affordance (DESIGN.md §1). Settings stacks nine of these; in the
  // accent they were the loudest thing in the app.
  it("checked state does not spend the accent", () => {
    render(<Switch defaultChecked aria-label="Payday greetings" />);
    const el = screen.getByRole("switch", { name: "Payday greetings" });
    expect(el).toHaveAttribute("data-state", "checked");
    expect(el.className).toContain("data-[state=checked]:bg-foreground");
    expect(el.className).not.toMatch(/data-\[state=checked\]:bg-(primary|accent)/);
  });
});
