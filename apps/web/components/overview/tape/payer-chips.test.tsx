import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PayerChips } from "./payer-chips";
import type { PayerRank } from "../../../lib/income-tape/aggregates";

// KO and O are universal placeholders (sage-hygiene/no-identifying-tickers), not real holdings.
const PAYERS: PayerRank[] = [
  { symbol: "KO", next12: 400 },
  { symbol: "O", next12: 120 },
  { symbol: "MSFT", next12: 0 }, // sold: nothing coming in the next 12 months
];

describe("PayerChips", () => {
  it("gives every chip a pointer cursor and a hover state", () => {
    render(<PayerChips payers={PAYERS} focus={null} onPick={() => {}} />);
    const button = screen.getByRole("button", { name: /^KO/ });
    expect(button.className).toContain("cursor-pointer");
    expect(button.className).toContain("group");
    // The hover wash/text change is applied to the Chip via the button's group.
    const chip = button.firstElementChild as HTMLElement;
    expect(chip.className).toMatch(/group-hover:/);
  });

  it("hides a sold payer by default and offers to show it", () => {
    render(<PayerChips payers={PAYERS} focus={null} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /^KO/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^O/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^MSFT/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 no longer held" })).toBeInTheDocument();
  });

  it("reveals sold payers on click, and toggles the label", () => {
    render(<PayerChips payers={PAYERS} focus={null} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 no longer held" }));
    expect(screen.getByRole("button", { name: /^MSFT/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide no longer held" })).toBeInTheDocument();
  });

  it("keeps a focused sold payer visible even while collapsed", () => {
    render(<PayerChips payers={PAYERS} focus="MSFT" onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /^MSFT/ })).toBeInTheDocument();
    // Still collapsed: the toggle still offers to show the rest.
    expect(screen.getByRole("button", { name: "Show 1 no longer held" })).toBeInTheDocument();
  });

  it("always shows held payers regardless of the sold toggle", () => {
    render(<PayerChips payers={PAYERS} focus={null} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /^KO/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^O/ })).toBeInTheDocument();
  });

  it("picks a payer on click", () => {
    const onPick = vi.fn();
    render(<PayerChips payers={PAYERS} focus={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /^KO/ }));
    expect(onPick).toHaveBeenCalledWith("KO");
  });
});
