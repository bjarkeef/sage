import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const options = [
  { label: "Buy", value: "buy" },
  { label: "Sell", value: "sell" },
  { label: "Dividend", value: "dividend" },
];

describe("SegmentedControl", () => {
  it("renders all options", () => {
    render(<SegmentedControl options={options} value="buy" onChange={() => {}} />);
    expect(screen.getByText("Buy")).toBeDefined();
    expect(screen.getByText("Sell")).toBeDefined();
    expect(screen.getByText("Dividend")).toBeDefined();
  });

  it("marks the active option with data-active", () => {
    render(<SegmentedControl options={options} value="sell" onChange={() => {}} />);
    expect(screen.getByText("Sell").closest("button")?.getAttribute("data-active")).toBe("true");
    expect(screen.getByText("Buy").closest("button")?.getAttribute("data-active")).toBe("false");
  });

  it("marks the active option with the raised-card treatment", () => {
    render(<SegmentedControl options={options} value="buy" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Buy" }).className).toContain("bg-card");
    expect(screen.getByRole("radio", { name: "Sell" }).className).not.toContain("bg-card");
  });

  it("draws its own focus ring rather than leaning on the UA outline", () => {
    // It was the only interactive primitive in the package without one, so a
    // keyboard user tabbing through a range picker had nothing to follow.
    render(<SegmentedControl options={options} value="buy" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Sell" }).className).toContain("focus-visible:ring-2");
  });

  it("keeps a multi-word label on one line", () => {
    // At 375px "Year to date" wrapped to two lines; a caller that runs out of
    // room scrolls the control instead.
    render(
      <SegmentedControl
        options={[...options, { label: "Year to date", value: "ytd" }]}
        value="buy"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Year to date" }).className).toContain(
      "whitespace-nowrap",
    );
  });

  it("calls onChange when an option is clicked", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="buy" onChange={onChange} />);
    fireEvent.click(screen.getByText("Dividend"));
    expect(onChange).toHaveBeenCalledWith("dividend");
  });

  it("is nameless by default, and takes a name via aria-labelledby", () => {
    // <label for> can't target role="radiogroup" — it only binds labelable
    // elements — so a caller with a visible label must wire this explicitly.
    const { rerender } = render(
      <SegmentedControl options={options} value="buy" onChange={() => {}} />,
    );
    expect(screen.getByRole("radiogroup")).not.toHaveAccessibleName();

    rerender(
      <div>
        <span id="mode-label">Type</span>
        <SegmentedControl
          options={options}
          value="buy"
          onChange={() => {}}
          aria-labelledby="mode-label"
        />
      </div>,
    );
    expect(screen.getByRole("radiogroup", { name: "Type" })).toBeInTheDocument();
  });

  it("takes a description via aria-describedby", () => {
    render(
      <div>
        <span id="why">Locked because of reasons</span>
        <SegmentedControl
          options={options}
          value="buy"
          onChange={() => {}}
          aria-describedby="why"
        />
      </div>,
    );
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription("Locked because of reasons");
  });

  it("can be locked on its value: every option disabled, clicks ignored, the value still announced", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="sell" onChange={onChange} disabled />);
    const buy = screen.getByRole("radio", { name: "Buy" });
    expect(buy).toBeDisabled();
    fireEvent.click(buy);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Sell" })).toHaveAttribute("aria-checked", "true");
  });
});
