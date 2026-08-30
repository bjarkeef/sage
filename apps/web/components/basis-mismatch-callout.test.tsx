import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BasisMismatchCallout } from "./basis-mismatch-callout";
import type { BasisFindingDTO } from "../lib/types";

function finding(overrides: Partial<BasisFindingDTO> = {}): BasisFindingDTO {
  return {
    symbol: "SPLITCO",
    factor: 10.06,
    mismatched: 4,
    samples: 5,
    firstDate: "2025-10-27",
    lastDate: "2025-11-07",
    ...overrides,
  };
}

describe("BasisMismatchCallout", () => {
  it("renders nothing when there is nothing to report", () => {
    const { container } = render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the holding and the size of the disagreement", () => {
    render(
      <BasisMismatchCallout findings={[finding()]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText(/10\.1×/)).toBeInTheDocument();
  });

  it("reports how many transactions disagree out of how many were checked", () => {
    render(
      <BasisMismatchCallout findings={[finding()]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(screen.getByText(/4 of 5 checked transactions/)).toBeInTheDocument();
  });

  it("says figures may be wrong, and does not claim to know why", () => {
    const { container } = render(
      <BasisMismatchCallout findings={[finding()]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(screen.getByText(/may be wrong/i)).toBeInTheDocument();
    // Phase 1 detects THAT the bases differ, never why — a split, a minor-unit
    // confusion and an ADR ratio change are indistinguishable from here.
    expect(container.textContent).not.toMatch(/because|caused by|reverse split|split-adjusted/i);
  });

  it("says plainly that nothing was adjusted", () => {
    render(
      <BasisMismatchCallout findings={[finding()]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(screen.getByText(/Nothing has been adjusted/i)).toBeInTheDocument();
  });

  it("lists every affected holding", () => {
    render(
      <BasisMismatchCallout
        findings={[finding(), finding({ symbol: "PENCECO", factor: 100 })]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText("PENCECO")).toBeInTheDocument();
  });

  it("renders nothing when there are neither findings nor unverified splits", () => {
    const { container } = render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={[]} historyIncomplete={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names a split it could not check, and says nothing was corrected", () => {
    render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={["DARKCO"]} historyIncomplete={[]} />,
    );
    expect(screen.getByText(/DARKCO/)).toBeInTheDocument();
    expect(screen.getByText(/could not be checked/i)).toBeInTheDocument();
  });

  it("shows both sections when both apply", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={["DARKCO"]}
        historyIncomplete={[]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText(/DARKCO/)).toBeInTheDocument();
  });
  it("names holdings whose stored price history is short", () => {
    render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={[]} historyIncomplete={["FIZZCO"]} />,
    );
    expect(screen.getByText(/FIZZCO/)).toBeInTheDocument();
    expect(screen.getByText(/no stored price history reaching back/i)).toBeInTheDocument();
  });

  it("does not imply the short history is temporary or invite a retry", () => {
    render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={[]} historyIncomplete={["FIZZCO"]} />,
    );
    expect(screen.queryByText(/try again|retry|shortly|temporar|refresh/i)).not.toBeInTheDocument();
  });

  it("renders the short-history paragraph even when nothing else applies", () => {
    const { container } = render(
      <BasisMismatchCallout findings={[]} unverifiedSplits={[]} historyIncomplete={["FIZZCO"]} />,
    );
    expect(container).not.toBeEmptyDOMElement();
  });
});
