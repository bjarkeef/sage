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

  it("outline variant uses a hairline instead of a wash", () => {
    render(<Chip variant="outline">auto</Chip>);
    const chip = screen.getByText("auto");
    expect(chip.className).toContain("border-hairline");
    expect(chip.className).not.toContain("bg-surface-active");
  });
});
