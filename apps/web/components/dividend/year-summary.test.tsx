import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { YearSummary } from "./year-summary";

describe("YearSummary", () => {
  const progress = {
    received: 55.72,
    expected: 31.19,
    total: 86.91,
    currency: "USD",
    mixedCurrency: false,
  };

  it("leads with the year's total and derives the rate rows from it", () => {
    render(<YearSummary progress={progress} year={2026} />);
    expect(screen.getByTestId("year-total")).toHaveTextContent("$86.91");
    // 86.91 / 12 and 86.91 / 365 — labelled as derivations, not measurements.
    expect(screen.getByTestId("year-monthly")).toHaveTextContent("$7.24");
    expect(screen.getByTestId("year-daily")).toHaveTextContent("$0.24");
    expect(screen.getByTestId("year-expected")).toHaveTextContent("$31.19");
  });

  it("divides by 366 in a leap year", () => {
    render(<YearSummary progress={{ ...progress, total: 366 }} year={2028} />);
    expect(screen.getByTestId("year-daily")).toHaveTextContent("$1.00");
  });

  it("hides 'yet to receive' when the year has nothing left to come", () => {
    // A fully past year would otherwise show a $0.00 row that says nothing.
    render(
      <YearSummary
        progress={{ received: 40, expected: 0, total: 40, currency: "USD", mixedCurrency: false }}
        year={2025}
      />,
    );
    expect(screen.queryByTestId("year-expected")).not.toBeInTheDocument();
    expect(screen.getByTestId("year-total")).toHaveTextContent("$40.00");
  });

  it("hides 'yet to receive' when it would just repeat the hero", () => {
    // Pick a future year and every month is ahead, so `expected === total` and
    // the band printed the same figure twice under two labels.
    render(
      <YearSummary
        progress={{ received: 0, expected: 120, total: 120, currency: "USD", mixedCurrency: false }}
        year={2029}
      />,
    );
    expect(screen.queryByTestId("year-expected")).not.toBeInTheDocument();
    expect(screen.getByTestId("year-total")).toHaveTextContent("$120.00");
  });

  it("renders em dashes rather than throwing when there is no currency", () => {
    // `Intl.NumberFormat(…, { currency: "" })` throws a RangeError; this
    // white-screened /dividends once.
    render(
      <YearSummary
        progress={{ received: 0, expected: 0, total: 0, currency: "", mixedCurrency: false }}
        year={2026}
      />,
    );
    expect(screen.getByTestId("year-total")).toHaveTextContent("—");
  });

  it("renders a dash instead of a total that mixes currencies", () => {
    // FX-incomplete: some months converted to the display currency, some did
    // not. There IS a currency on the payload — the conflict, not a missing
    // value, is what withholds the figure.
    render(
      <YearSummary
        progress={{ received: 100, expected: 10, total: 110, currency: "DKK", mixedCurrency: true }}
        year={2026}
      />,
    );
    expect(screen.getByTestId("year-total")).toHaveTextContent("—");
    expect(screen.getByTestId("year-monthly")).toHaveTextContent("—");
    expect(screen.getByTestId("year-daily")).toHaveTextContent("—");
    expect(screen.getByTestId("year-expected")).toHaveTextContent("—");
  });
});
