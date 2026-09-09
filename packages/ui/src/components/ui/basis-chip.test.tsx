import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { BasisChip } from "./basis-chip";

beforeAll(() => {
  // Radix Popper (behind InfoTooltip's Popover) needs ResizeObserver; jsdom
  // has none.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO;
  }
});

describe("BasisChip", () => {
  it("states the basis and carries the explanation", () => {
    render(<BasisChip taxed />);
    expect(screen.getByText("After tax")).toBeInTheDocument();
    expect(screen.getByLabelText("About this figure")).toBeInTheDocument();
  });

  it("says before tax when no rate is configured", () => {
    render(<BasisChip taxed={false} />);
    expect(screen.getByText("Before tax")).toBeInTheDocument();
  });
});
