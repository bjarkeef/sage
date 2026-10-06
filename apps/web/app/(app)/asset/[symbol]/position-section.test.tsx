import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionSection } from "./position-section";
import { assetDetail, notHeld } from "../../../../lib/test/asset-fixtures";

const { position } = assetDetail();

describe("PositionSection", () => {
  it("shows shares, average cost, value, gain, weight and fees, in one row", () => {
    const { container } = render(
      <PositionSection position={position} weight={{ ok: true, value: 0.08 }} />,
    );
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    expect(screen.getByText("$6,000.00")).toBeInTheDocument();
    expect(container.textContent).toMatch(/\+\$2,000\.00/);
    expect(screen.getByText("8.0%")).toBeInTheDocument();
    expect(screen.getByText("$4.00")).toBeInTheDocument();
    const card = container.querySelector("[data-card]")!;
    expect(card.className).toContain("lg:grid-cols-6");
  });

  it("no longer repeats the income figures that live in 'What it pays you'", () => {
    render(<PositionSection position={position} weight={{ ok: true, value: 0.08 }} />);
    expect(screen.queryByText("Yield on cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Forward income")).not.toBeInTheDocument();
    expect(screen.queryByText("Dividend income")).not.toBeInTheDocument();
  });

  it("says why a figure is missing", () => {
    render(
      <PositionSection
        position={{ ...position, marketValue: null, unrealizedGainLoss: null }}
        weight={{ ok: false, reason: "Your book has not loaded" }}
      />,
    );
    expect(screen.getAllByLabelText("Not available: No current price")).toHaveLength(2);
    expect(screen.getByLabelText("Not available: Your book has not loaded")).toBeInTheDocument();
  });

  it("is absent when the holding is not in your book", () => {
    const { container } = render(
      <PositionSection position={notHeld().position} weight={{ ok: false, reason: "x" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lets the gain Delta wrap at narrow widths, so the page never scrolls sideways", () => {
    const { container } = render(
      <PositionSection position={position} weight={{ ok: true, value: 0.08 }} />,
    );
    const gainDelta = container.querySelector("[data-tone]");
    expect(gainDelta).toHaveClass("flex-wrap");
  });
});
