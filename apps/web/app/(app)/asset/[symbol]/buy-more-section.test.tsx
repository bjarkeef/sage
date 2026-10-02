import type { ComponentProps } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuyMoreSection } from "./buy-more-section";
import {
  TODAY,
  assetDetail,
  day,
  fundDetail,
  nonPayer,
  ratings,
} from "../../../../lib/test/asset-fixtures";

function renderBuy(over: Partial<ComponentProps<typeof BuyMoreSection>> = {}) {
  return render(
    <BuyMoreSection
      detail={assetDetail()}
      taxRate={35}
      ratings={ratings()}
      todayISO={TODAY}
      {...over}
    />,
  );
}

describe("BuyMoreSection", () => {
  it("sets today's yield against its own five years, after tax, printing all three values", () => {
    renderBuy();
    expect(screen.getByText("Yield vs its own 5 years")).toBeInTheDocument();
    expect(screen.getByText("Low 1.30%")).toBeInTheDocument(); // 2% × 0.65
    expect(screen.getByText("Today 2.17%")).toBeInTheDocument();
    expect(screen.getByText("High 3.25%")).toBeInTheDocument();
    expect(screen.getByText("after tax")).toBeInTheDocument();
  });

  it("sets the header price in its 52-week range", () => {
    renderBuy();
    expect(screen.getByText("Low $55.00")).toBeInTheDocument();
    expect(screen.getByText("Today $60.00")).toBeInTheDocument();
    expect(screen.getByText("High $70.00")).toBeInTheDocument();
  });

  it("lists payout, P/E, analysts from the header price, market cap with its currency, and beta", () => {
    const { container } = renderBuy();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("24.5")).toBeInTheDocument();
    expect(container.textContent).toContain("Buy · 19 analysts · mean $66.00 (+10.0%)");
    expect(container.textContent).not.toContain("+3.1%"); // what the provider's 64 would give
    expect(screen.getByText("$250.00B")).toBeInTheDocument();
    expect(screen.getByText("0.60")).toBeInTheDocument();
  });

  it("never shows the provider's gross dividend yield", () => {
    renderBuy();
    expect(screen.queryByText(/dividend yield/i)).not.toBeInTheDocument();
  });

  it("dates every provider figure on hover, and inline once it is more than 7 days old", () => {
    renderBuy({ detail: { ...assetDetail(), profileAsOf: day(-10) } });
    expect(screen.getByText("P/E").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("as of"),
    );
    expect(
      screen.getAllByText(/^as of [A-Z][a-z]{2} \d{1,2}, \d{4}$/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("marks implausible provider values with a check, saying why", () => {
    const d = assetDetail();
    renderBuy({
      detail: {
        ...d,
        income: { ...d.income, payoutRatio: 3.5 },
        profile: { ...d.profile, peRatio: "-4" },
        yieldRange5y: { low: 0.01, high: 0.08, current: 0.033333 },
      },
    });
    expect(screen.getByRole("note", { name: /0–300%/ })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: /P\/E at or below zero/ })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: /more than 5× the low/ })).toBeInTheDocument();
  });

  it("flags today's yield when it is not the trailing dividend ÷ the header price", () => {
    const d = assetDetail();
    renderBuy({ detail: { ...d, income: { ...d.income, currentYield: 0.05 } } });
    expect(
      screen.getByRole("note", { name: /trailing dividend ÷ today's price/ }),
    ).toBeInTheDocument();
  });

  it("for a fund hides P/E and payout and shows the expense ratio", () => {
    renderBuy({ detail: fundDetail() });
    expect(screen.queryByText("P/E")).not.toBeInTheDocument();
    expect(screen.queryByText("Payout ratio")).not.toBeInTheDocument();
    expect(screen.getByText("Expense ratio")).toBeInTheDocument();
    expect(screen.getByText("0.20%")).toBeInTheDocument();
  });

  it("hides rows it can't fill — never '—'", () => {
    const d = assetDetail();
    renderBuy({ detail: { ...d, profile: { ...d.profile, peRatio: null, beta: null } } });
    expect(screen.queryByText("P/E")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("opens the analyst detail on request", () => {
    renderBuy();
    fireEvent.click(screen.getByRole("button", { name: "Analyst detail" }));
    expect(screen.getByText("19 analysts")).toBeInTheDocument();
  });

  it("is absent when there is nothing to show", () => {
    const d = nonPayer();
    const { container } = renderBuy({
      ratings: null,
      detail: {
        ...d,
        profile: {
          ...d.profile,
          peRatio: null,
          beta: null,
          marketCap: null,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
        },
      },
    });
    expect(container).toBeEmptyDOMElement();
  });
});
