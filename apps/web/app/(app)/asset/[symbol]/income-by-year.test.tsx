import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomeByYear } from "./income-by-year";
import { TODAY } from "../../../../lib/test/asset-fixtures";
import type { AssetUpcomingDTO } from "../../../../lib/types";

const Y = Number(TODAY.slice(0, 4));
const paid = (date: string, amount: string) => ({
  exDate: date,
  paymentDate: date,
  amountPerShare: amount,
  currency: "USD",
});
const quarterOf = (year: number, amount: string) =>
  ["02-10", "05-10", "08-10", "11-10"].map((md) => paid(`${year}-${md}`, amount));
const ahead = (date: string, certainty: AssetUpcomingDTO["certainty"]): AssetUpcomingDTO => ({
  exDate: date,
  paymentDate: date,
  amountPerShare: "0.30",
  currency: "USD",
  certainty,
  window: "next12m",
});

// Newest first, as the endpoint sends it.
const HISTORY = [
  paid(`${Y}-05-10`, "0.30"),
  paid(`${Y}-02-10`, "0.30"),
  ...quarterOf(Y - 1, "0.30").reverse(),
  ...quarterOf(Y - 2, "0.30").reverse(),
  ...quarterOf(Y - 3, "0.275").reverse(),
  ...quarterOf(Y - 4, "0.40").reverse(),
  paid(`${Y - 5}-11-10`, "0.40"),
];
const UPCOMING = [
  ahead(`${Y}-08-10`, "confirmed"),
  ahead(`${Y}-11-10`, "estimated"),
  ahead(`${Y + 1}-02-10`, "estimated"),
];

function renderBars(over: Partial<Parameters<typeof IncomeByYear>[0]> = {}) {
  return render(
    <IncomeByYear
      history={HISTORY}
      upcoming={UPCOMING}
      currency="USD"
      cagr5y="0.050000"
      annualDividend={{ amount: "1.20", currency: "USD" }}
      todayISO={TODAY}
      {...over}
    />,
  );
}

describe("IncomeByYear", () => {
  it("draws one bar per year, from the first paying year to one forecast year, and says it is gross per share", () => {
    renderBars();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("gross, per share")).toBeInTheDocument();
  });

  it("names a cut year under the bars and fills it with the loss tone", () => {
    renderBars();
    expect(screen.getByText(`${Y - 3} was cut 31%`)).toBeInTheDocument();
    const cut = screen.getByRole("listitem", { name: new RegExp(`^${Y - 3}`) });
    expect(cut.querySelector('[data-segment="paid"]')).toHaveAttribute("data-fill", "loss");
  });

  it("marks the partial first year the way the tape's ribbon does", () => {
    renderBars();
    expect(screen.getByText(`${Y - 5}*`)).toBeInTheDocument();
    expect(screen.getByText(/part year/)).toBeInTheDocument();
  });

  it("splits the current year into paid and still to come in the certainty tones", () => {
    renderBars();
    const cur = screen.getByRole("listitem", { name: new RegExp(`^${Y}:`) });
    // `data-fill` names the token each segment is painted with (jsdom does not
    // resolve `var()` inside a background shorthand, so the style itself can't be read).
    expect(cur.querySelector('[data-segment="paid"]')).toHaveAttribute("data-fill", "paid");
    expect(cur.querySelector('[data-segment="confirmed"]')).toHaveAttribute(
      "data-fill",
      "confirmed",
    );
    expect(cur.querySelector('[data-segment="estimated"]')).toHaveAttribute(
      "data-fill",
      "estimated",
    );
  });

  it("states five-year growth per year", () => {
    renderBars();
    expect(screen.getByText("5-yr growth +5.0%/yr")).toBeInTheDocument();
  });

  it("flags a year paying more than 3× the one before", () => {
    renderBars({
      history: [...quarterOf(Y - 1, "1.00").reverse(), ...quarterOf(Y - 2, "0.30").reverse()],
      upcoming: [],
    });
    expect(screen.getByRole("note", { name: /Check: More than 3×/ })).toBeInTheDocument();
  });

  it("flags itself when its trailing year disagrees with the trailing total", () => {
    renderBars({ annualDividend: { amount: "2.50", currency: "USD" } });
    expect(screen.getByRole("note", { name: /Check: .*trailing/ })).toBeInTheDocument();
  });

  it("renders nothing for a holding that never paid", () => {
    const { container } = renderBars({ history: [], upcoming: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
