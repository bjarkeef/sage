import type { ComponentProps } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AnswerStrip } from "./answer-strip";
import { REASONS } from "../../../../lib/asset-page/figures";
import {
  TODAY,
  assetDetail,
  day,
  fundDetail,
  nonPayer,
  notHeld,
  ratings,
  usd,
} from "../../../../lib/test/asset-fixtures";

function renderStrip(over: Partial<ComponentProps<typeof AnswerStrip>> = {}) {
  return render(
    <AnswerStrip
      detail={assetDetail()}
      taxRate={35}
      todayISO={TODAY}
      weight={{ ok: true, value: 0.08 }}
      ratings={ratings()}
      addAction={<button type="button">Add transaction</button>}
      {...over}
    />,
  );
}

const tile = (label: string) => screen.getByText(label).closest("[data-card]") as HTMLElement;

describe("AnswerStrip", () => {
  it("answers all four questions for a held payer", () => {
    renderStrip();

    const pays = tile("Pays you");
    expect(within(pays).getByText("$130.00")).toBeInTheDocument(); // 4 × 0.50 × 100 × 0.65
    expect(pays.textContent).toContain("next 12 months, after tax");
    expect(pays.textContent).toContain("next payment: Aug 29, 2026 · $32.50 · confirmed");

    const position = tile("Your position");
    expect(position.textContent).toMatch(/\+\$2,000\.00/);
    expect(position.textContent).toContain("(+50.00%)");
    expect(position.textContent).toContain("100 shares · 8.0% of your book");

    const buy = tile("Buy more?");
    expect(within(buy).getByText("2.17%")).toBeInTheDocument(); // 3.3333% × 0.65
    expect(buy.textContent).toContain("after tax · middle of its 5-yr range");
    expect(buy.textContent).toContain("analysts +10.0% to mean target");

    const what = tile("What it is");
    expect(within(what).getByText("Consumer Defensive")).toBeInTheDocument();
    expect(what.textContent).toContain("United States · 79,000 employees");
  });

  it("measures analyst upside from the header price, never the provider's currentPrice", () => {
    // ratings().currentPrice is 64: from it the upside would read +3.1%.
    renderStrip();
    expect(tile("Buy more?").textContent).not.toContain("+3.1%");
  });

  it("shows the per-share figure and the Add transaction action when not held", () => {
    renderStrip({ detail: notHeld() });
    expect(within(tile("Pays you")).getByText("$1.30 / share / yr")).toBeInTheDocument();
    expect(tile("Pays you").textContent).toContain("$0.325 / share");
    const position = tile("Your position");
    expect(within(position).getByText("Not in your book")).toBeInTheDocument();
    expect(within(position).getByRole("button", { name: "Add transaction" })).toBeInTheDocument();
  });

  it("keeps four tiles when data is missing — each with '—' and its reason, never a zero", () => {
    const d = nonPayer();
    const { container } = renderStrip({
      detail: { ...d, profile: { ...d.profile, sector: null } },
      ratings: null,
    });
    expect(container.querySelectorAll("[data-card]")).toHaveLength(4);
    expect(screen.getAllByLabelText("Not available: No dividends on record")).toHaveLength(2);
    expect(
      screen.getByLabelText("Not available: The provider gives no sector"),
    ).toBeInTheDocument();
    expect(screen.queryByText("0.00%")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("says why the weight is missing instead of hiding it — a dash with the reason on hover", () => {
    renderStrip({ weight: { ok: false, reason: "Your book has not loaded" } });
    const position = tile("Your position");
    expect(position.textContent).toContain("100 shares · — of your book");
    expect(
      within(position).getByLabelText("Not available: Your book has not loaded"),
    ).toHaveAttribute("title", "Your book has not loaded");
  });

  it("shows '—' for the weight of a mixed-currency book with no display currency — never a sum across currencies", () => {
    renderStrip({ weight: { ok: false, reason: REASONS.mixedBookCurrency } });
    const position = tile("Your position");
    expect(position.textContent).toContain("100 shares · — of your book");
    expect(position.textContent).not.toMatch(/\d% of your book/);
    expect(
      within(position).getByLabelText(
        "Not available: Set a display currency to compare holdings in different currencies",
      ),
    ).toBeInTheDocument();
  });

  it("dates its provider figures, inline once more than 7 days old", () => {
    renderStrip({ detail: { ...assetDetail(), profileAsOf: day(-10) } });
    const what = tile("What it is");
    expect(what).toHaveAttribute("title", expect.stringContaining("as of"));
    expect(what.textContent).toMatch(/as of [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });

  it("describes a fund by its category and assets under management", () => {
    renderStrip({ detail: fundDetail() });
    const what = tile("What it is");
    expect(within(what).getByText("Global Large-Cap Blend Equity")).toBeInTheDocument();
    expect(what.textContent).toContain("Ireland · AUM $7.79B");
  });

  it("says the next payment of an unheld payer is after tax, like the figure above it", () => {
    renderStrip({ detail: notHeld() });
    expect(tile("Pays you").textContent).toMatch(
      /next payment: .* · \$0\.325\d* \/ share, after tax · /,
    );
    renderStrip({ detail: notHeld(), taxRate: null });
    expect(screen.getAllByText(/next payment:/).at(-1)!.textContent).toContain(
      "/ share, before tax",
    );
  });

  it("never prints a provider's zero as a fact: no '0 employees', no 'AUM $0'", () => {
    const d = assetDetail();
    const { unmount } = renderStrip({
      detail: { ...d, profile: { ...d.profile, fullTimeEmployees: "0" } },
    });
    expect(tile("What it is").textContent).not.toMatch(/employees/);
    unmount();
    const f = fundDetail();
    renderStrip({
      detail: { ...f, profile: { ...f.profile, fund: { ...f.profile.fund!, totalAssets: "0" } } },
    });
    expect(tile("What it is").textContent).not.toMatch(/AUM|\$0/);
  });

  it("states 'before tax' when no tax rate is set", () => {
    renderStrip({ taxRate: null });
    expect(within(tile("Pays you")).getByText("$200.00")).toBeInTheDocument();
    expect(tile("Pays you").textContent).toContain("next 12 months, before tax");
    expect(tile("Buy more?").textContent).toContain("before tax");
  });

  it("lets values and the gain Delta wrap, so a narrow tile never pushes the page sideways", () => {
    const { container } = renderStrip();
    const values = container.querySelectorAll("[data-tile-value]");
    expect(values).toHaveLength(4);
    for (const v of values) expect(v.className).toContain("[overflow-wrap:anywhere]");
    expect(tile("Your position").querySelector("[data-tone]")).toHaveClass("flex-wrap");
    for (const c of container.querySelectorAll("[data-card]")) expect(c).toHaveClass("min-w-0");
  });

  it("tones the analyst upside by its sign", () => {
    // Header price 60: a mean of 66 is +10.0%, 54 is -10.0%.
    const { unmount } = renderStrip();
    expect(screen.getByText("+10.0%")).toHaveAttribute("data-tone", "gain");
    unmount();
    renderStrip({ ratings: ratings({ targets: { ...ratings().targets, mean: usd("54") } }) });
    expect(screen.getByText("−10.0%")).toHaveAttribute("data-tone", "loss");
  });

  it("dates the analyst figure: on hover, and inline once more than 7 days old", () => {
    const { unmount } = renderStrip();
    expect(tile("Buy more?")).toHaveAttribute("title", expect.stringContaining("as of"));
    expect(tile("Buy more?").textContent).not.toMatch(/as of [A-Z]/);
    unmount();
    renderStrip({ ratings: ratings({ asOf: `${day(-10)}T08:00:00.000Z` }) });
    expect(tile("Buy more?").textContent).toMatch(/as of [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  });
});
