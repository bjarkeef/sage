import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";

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

describe("Popover", () => {
  it("renders content when open", () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Detail body</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("Detail body")).toBeInTheDocument();
  });

  it("hides content when closed", () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Detail body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("Detail body")).not.toBeInTheDocument();
  });
});
