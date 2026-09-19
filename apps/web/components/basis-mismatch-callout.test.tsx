import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BasisMismatchCallout } from "./basis-mismatch-callout";
import type { BasisFindingDTO } from "../lib/types";

function finding(overrides: Partial<BasisFindingDTO> = {}): BasisFindingDTO {
  return {
    symbol: "SPLITCO",
    factor: 9.94,
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
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the holding and the size of the disagreement", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText(/9\.9×/)).toBeInTheDocument();
  });

  it("reports how many transactions disagree out of how many were checked", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByText(/4 of 5 checked transactions/)).toBeInTheDocument();
  });

  it("says figures may be wrong, and does not claim to know why", () => {
    const { container } = render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByText(/may be wrong/i)).toBeInTheDocument();
    // Phase 1 detects THAT the bases differ, never why — a split, a minor-unit
    // confusion and an ADR ratio change are indistinguishable from here.
    expect(container.textContent).not.toMatch(/because|caused by|reverse split|split-adjusted/i);
  });

  it("says plainly that nothing was adjusted", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByText(/Nothing has been adjusted/i)).toBeInTheDocument();
  });

  it("lists every affected holding", () => {
    render(
      <BasisMismatchCallout
        findings={[finding(), finding({ symbol: "PENCECO", factor: 100 })]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO", "PENCECO"]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText("PENCECO")).toBeInTheDocument();
  });

  it("renders nothing when there are neither findings nor unverified splits", () => {
    const { container } = render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names a split it could not check, and says nothing was corrected", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["DARKCO"]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
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
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.getByText(/DARKCO/)).toBeInTheDocument();
  });
  it("names holdings whose stored price history is short", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={["FIZZCO"]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByText(/FIZZCO/)).toBeInTheDocument();
    expect(screen.getByText(/no stored price history reaching back/i)).toBeInTheDocument();
  });

  it("does not imply the short history is temporary or invite a retry", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={["FIZZCO"]}
        splitSymbols={[]}
      />,
    );
    expect(screen.queryByText(/try again|retry|shortly|temporar|refresh/i)).not.toBeInTheDocument();
  });

  it("renders the short-history paragraph even when nothing else applies", () => {
    const { container } = render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={["FIZZCO"]}
        splitSymbols={[]}
      />,
    );
    expect(container).not.toBeEmptyDOMElement();
  });

  it("links from the basis banner to the corporate-actions page", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["SPLITCO"]}
      />,
    );
    expect(screen.getByRole("link", { name: /see what sage did/i })).toHaveAttribute(
      "href",
      "/corporate-actions",
    );
  });

  it("links to corporate-actions when there is an unverified split", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["DARKCO"]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByRole("link", { name: /see what sage did/i })).toHaveAttribute(
      "href",
      "/corporate-actions",
    );
  });

  it("does not link to corporate-actions for history-incomplete alone", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={[]}
        historyIncomplete={["FIZZCO"]}
        splitSymbols={[]}
      />,
    );
    expect(screen.queryByRole("link", { name: /see what sage did/i })).not.toBeInTheDocument();
  });

  // The bug this pins: a finding is split-agnostic (a minor-unit error or an
  // ADR ratio change looks identical to a split from here), but
  // /corporate-actions only ever renders `type === "split"` rows. Linking on
  // `findings.length > 0` alone sent a reader to a page with nothing about
  // the holding they just read a warning for.
  it("does not link when the finding's symbol carries no recorded split", () => {
    render(
      <BasisMismatchCallout
        findings={[finding()]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByText("SPLITCO")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /see what sage did/i })).not.toBeInTheDocument();
  });

  it("links when at least one finding's symbol has a recorded split, even alongside one that does not", () => {
    render(
      <BasisMismatchCallout
        findings={[finding(), finding({ symbol: "PENCECO" })]}
        unverifiedSplits={[]}
        historyIncomplete={[]}
        splitSymbols={["PENCECO"]}
      />,
    );
    expect(screen.getByRole("link", { name: /see what sage did/i })).toHaveAttribute(
      "href",
      "/corporate-actions",
    );
  });
  // The two ways a split ends up unverified are not interchangeable, and
  // /corporate-actions already tells them apart (`action-row.tsx`). A symbol
  // whose trades DO land on stored-price days but had no FX rate to convert
  // against must not be described as having no such trades — the reader who
  // follows "See what Sage did" would find the opposite claim waiting there.
  it("does not claim an fx-gap split has no transaction on a day with a stored price", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["RATECO"]}
        fxGapSymbols={["RATECO"]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByText(/RATECO/)).toBeInTheDocument();
    expect(screen.queryByText(/falls on a day with a stored price/i)).not.toBeInTheDocument();
  });

  it("names the missing exchange rate as the reason an fx-gap split went unchecked", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["RATECO"]}
        fxGapSymbols={["RATECO"]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByText(/exchange rate/i)).toBeInTheDocument();
  });

  it("keeps the missing-price-history wording for a split that is not an fx gap", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["DARKCO"]}
        fxGapSymbols={[]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    expect(screen.getByText(/falls on a day with a stored price/i)).toBeInTheDocument();
    expect(screen.queryByText(/exchange rate/i)).not.toBeInTheDocument();
  });

  it("separates the two causes when both kinds of unverified split are present", () => {
    render(
      <BasisMismatchCallout
        findings={[]}
        unverifiedSplits={["DARKCO", "RATECO"]}
        fxGapSymbols={["RATECO"]}
        historyIncomplete={[]}
        splitSymbols={[]}
      />,
    );
    const noPrice = screen.getByText(/falls on a day with a stored price/i);
    expect(noPrice.textContent).toContain("DARKCO");
    expect(noPrice.textContent).not.toContain("RATECO");
    const fxGap = screen.getByText(/exchange rate/i);
    expect(fxGap.textContent).toContain("RATECO");
    expect(fxGap.textContent).not.toContain("DARKCO");
  });
});
