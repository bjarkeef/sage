import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PayerChips } from "./payer-chips";
import { FocusCard } from "./focus-card";
import { HoverReadout } from "./hover-readout";
import type { PayerRank, PayerSummary } from "../../../lib/income-tape/aggregates";
import type { TapePoint } from "../../../lib/income-tape/points";

describe("PayerChips", () => {
  const payers: PayerRank[] = [
    { symbol: "KO", next12: 1200 },
    { symbol: "MSFT", next12: 800 },
    { symbol: "DUOMO.MI", next12: 400 },
  ];

  it("renders one button per payer in order, pressed only for the focused symbol", () => {
    render(<PayerChips payers={payers} focus="MSFT" onPick={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, " ").trim().split(" ")[0])).toEqual([
      "KO",
      "MSFT",
      "DUOMO.MI",
    ]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[2]).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no amount for a payer with nothing coming, rather than a 0", () => {
    render(
      <PayerChips
        payers={[...payers, { symbol: "SOLD", next12: 0 }]}
        focus={null}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "SOLD" }).textContent).toBe("SOLD");
    expect(screen.getByRole("button", { name: /^KO/ }).textContent).toBe("KO 1,200");
  });

  it("calls onPick with the clicked payer's symbol", () => {
    const onPick = vi.fn();
    render(<PayerChips payers={payers} focus={null} onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[2]!);
    expect(onPick).toHaveBeenCalledWith("DUOMO.MI");
  });
});

describe("FocusCard", () => {
  const next: TapePoint = {
    day: 20000,
    iso: "2026-10-15",
    symbol: "KO",
    amount: 45.5,
    certainty: "confirmed",
    headline: "forward",
  };

  const summary: PayerSummary = {
    symbol: "KO",
    next,
    last12: 180,
    next12: 200,
    changePct: 5.6,
    share: 0.123,
    frequency: "pays quarterly",
  };

  it("shows symbol, name · frequency, next payment, totals, change and share", () => {
    render(<FocusCard summary={summary} name="Coca-Cola" currency="DKK" onClose={vi.fn()} />);
    expect(screen.getByText("KO")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola · pays quarterly")).toBeInTheDocument();
    expect(screen.getByText(/Oct 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/46 confirmed/)).toBeInTheDocument();
    expect(screen.getByText("DKK 180")).toBeInTheDocument();
    expect(screen.getByText("DKK 200")).toBeInTheDocument();
    expect(screen.getByText("+5.6%")).toBeInTheDocument();
    expect(screen.getByText("12.3%")).toBeInTheDocument();
  });

  it("falls back to 'new position' and '—' share when there is nothing to compare", () => {
    const s: PayerSummary = { ...summary, next: null, changePct: null, share: null };
    render(<FocusCard summary={s} name={null} currency="DKK" onClose={vi.fn()} />);
    expect(screen.getByText("pays quarterly")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("new position")).toBeInTheDocument();
  });

  it("calls onClose when Clear focus is clicked", () => {
    const onClose = vi.fn();
    render(<FocusCard summary={summary} name="Coca-Cola" currency="DKK" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear focus" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("HoverReadout", () => {
  const point: TapePoint = {
    day: 20000,
    iso: "2026-10-15",
    symbol: "O",
    amount: 12.3,
    certainty: "estimated",
    headline: null,
  };
  const ghost: TapePoint = { ...point, day: 19635, iso: "2025-10-15", amount: 10 };

  it("shows symbol, amount, date and certainty", () => {
    render(<HoverReadout point={point} ghost={null} currency="DKK" x={0} y={0} />);
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText(/DKK/)).toBeInTheDocument();
    expect(screen.getByText(/12\.30/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 15, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/estimated/)).toBeInTheDocument();
    expect(screen.queryByText(/on last year/)).not.toBeInTheDocument();
  });

  it("shows the signed change against the ghost when given", () => {
    render(<HoverReadout point={point} ghost={ghost} currency="DKK" x={0} y={0} />);
    expect(screen.getByText(/\+23\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/on last year/)).toBeInTheDocument();
  });
});
