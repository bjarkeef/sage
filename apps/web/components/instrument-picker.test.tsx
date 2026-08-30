import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("./instrument-search", () => ({
  InstrumentSearch: ({ id }: { id?: string }) => (
    <input aria-label="Search ticker or name" id={id} />
  ),
}));

import { InstrumentPicker } from "./instrument-picker";

const AAPL = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock" as const,
};

describe("InstrumentPicker", () => {
  it("searches when nothing is chosen yet", () => {
    render(<InstrumentPicker instrument={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Search ticker or name")).toBeInTheDocument();
  });

  it("shows the chosen instrument with a way back to search", () => {
    render(<InstrumentPicker instrument={AAPL} onSelect={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("Apple Inc")).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("threads the id down to the search input so an external label can bind", () => {
    render(<InstrumentPicker instrument={null} id="txn-holding" onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Search ticker or name")).toHaveAttribute("id", "txn-holding");
  });

  it("renders NO search input when the instrument is locked", () => {
    // The gap this closes: opening the dialog from AAPL's own page used to
    // present an empty search box asking you to go and find AAPL. Asserting
    // absence, not "hidden" -- there must be nothing to mis-pick.
    render(<InstrumentPicker instrument={AAPL} locked />);
    expect(screen.queryByLabelText("Search ticker or name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });
});
