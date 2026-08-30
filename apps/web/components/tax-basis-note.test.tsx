import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxBasisNote } from "./tax-basis-note";

describe("TaxBasisNote", () => {
  it("states the rate and links to settings when one is configured", () => {
    const { container } = render(<TaxBasisNote rate={35} />);
    expect(container.textContent).toContain("Income and yields after 35% dividend tax");
    expect(container.textContent).toContain("Per-share amounts are as declared");
    expect(screen.getByRole("link", { name: /change in settings/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("prompts for a rate when none is set", () => {
    const { container } = render(<TaxBasisNote rate={null} />);
    expect(container.textContent).toContain("Figures are before tax");
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });

  it("renders a whole-number rate without a trailing decimal", () => {
    const { container } = render(<TaxBasisNote rate={27} />);
    expect(container.textContent).toContain("27%");
    expect(container.textContent).not.toContain("27.0");
  });
});
