import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "./section-header";

describe("SectionHeader", () => {
  it("renders a level-2 heading in sans, not caps mono", () => {
    render(<SectionHeader title="Upcoming dividends" />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2).toHaveTextContent("Upcoming dividends");
    expect(h2.className).not.toContain("label-caps");
    expect(h2.className).toContain("font-semibold");
  });

  it("renders right-aligned meta", () => {
    render(<SectionHeader title="Activity" meta="2 transactions" />);
    expect(screen.getByText("2 transactions")).toBeInTheDocument();
  });
});
