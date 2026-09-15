import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./chip";

describe("Chip", () => {
  it("renders a wash chip by default", () => {
    render(<Chip>dividend</Chip>);
    const chip = screen.getByText("dividend");
    expect(chip.className).toContain("rounded-badge");
    expect(chip.className).toContain("bg-surface-active");
  });

  it("tones tint the chip", () => {
    render(<Chip tone="income">monthly</Chip>);
    expect(screen.getByText("monthly").className).toContain("text-income");
  });

  // `primary` means "this one matters more", and it says so with weight, not
  // with the brand hue: chrome is the one place the accent may never go
  // (DESIGN.md §1). It must still out-rank `neutral`, or the distinction the
  // call sites encode — "Sage did something" vs "Sage did not" — is lost.
  it("primary tone emphasises without spending the accent", () => {
    render(<Chip tone="primary">In portfolio</Chip>);
    const chip = screen.getByText("In portfolio");
    expect(chip.className).not.toMatch(/bg-primary|text-primary|bg-accent/);
    expect(chip.className).toContain("text-foreground");
    render(<Chip tone="neutral">Unverified</Chip>);
    expect(screen.getByText("Unverified").className).toContain("text-muted-foreground");
  });

  it("outline variant uses a hairline instead of a wash", () => {
    render(<Chip variant="outline">auto</Chip>);
    const chip = screen.getByText("auto");
    expect(chip.className).toContain("border-hairline");
    expect(chip.className).not.toContain("bg-surface-active");
  });
});
