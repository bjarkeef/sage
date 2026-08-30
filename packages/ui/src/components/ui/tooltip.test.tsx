import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoTooltip } from "./tooltip";

beforeAll(() => {
  // Radix Popper needs ResizeObserver; jsdom has none.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO;
  }
});

describe("InfoTooltip", () => {
  it("hides the explanation until the trigger is activated", () => {
    render(<InfoTooltip label="About this figure">Shown before tax.</InfoTooltip>);
    expect(screen.queryByText("Shown before tax.")).not.toBeInTheDocument();
  });

  it("reveals the explanation when the trigger is clicked", () => {
    render(<InfoTooltip label="About this figure">Shown before tax.</InfoTooltip>);
    fireEvent.click(screen.getByRole("button", { name: "About this figure" }));
    expect(screen.getByText("Shown before tax.")).toBeInTheDocument();
  });
});
