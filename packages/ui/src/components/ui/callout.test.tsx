import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";

describe("Callout", () => {
  it("renders an info banner by default", () => {
    render(<Callout data-testid="c">Heads up</Callout>);
    const el = screen.getByTestId("c");
    expect(el).toHaveTextContent("Heads up");
    expect(el.className).toContain("rounded-card");
    expect(el).not.toHaveAttribute("role");
  });

  it("error tone is an alert", () => {
    render(<Callout tone="error">Failed</Callout>);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
  });

  it("success tone uses the gain tint", () => {
    render(
      <Callout tone="success" data-testid="c">
        Done
      </Callout>,
    );
    expect(screen.getByTestId("c").className).toContain("border-gain/30");
  });
});
