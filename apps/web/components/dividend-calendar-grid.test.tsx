import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DividendCalendarGrid as Grid } from "./dividend-calendar-grid";
import { buildCalendarEvents } from "../lib/dividend-events";
import { paymentYearBounds } from "../lib/dividend-year";
import type {
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  RetroactiveIncomeRowDTO,
} from "../lib/types";

const paid = {
  symbol: "O",
  name: "Realty Income",
  exDate: "2026-06-30",
  paymentDate: "2026-07-01",
  paymentDateEstimated: false,
  amountPerShare: "0.271",
  sharesHeld: "10",
  income: "2.71",
  currency: "USD",
};

const announced = {
  symbol: "ORCHRD",
  name: "Orchard Capital",
  declarationDate: "2026-06-20",
  exDate: "2026-07-08",
  recordDate: "2026-07-09",
  paymentDate: "2026-07-15",
  paymentDateEstimated: false,
  amountPerShare: "0.075",
  shares: "56",
  income: "4.20",
  currency: "USD",
};

const projectedLow = {
  symbol: "HIVAR",
  name: "Hivar Variable Income",
  projectedExDate: "2026-07-10",
  paymentDate: "2026-07-11",
  paymentDateEstimated: true,
  confidence: "low" as const,
  amountPerShare: "0.09",
  shares: "100",
  income: "9.00",
  currency: "USD",
};

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** The page owns `buildCalendarEvents` and `paymentYearBounds` now — the grid
 *  takes the results as props. These tests still describe the grid in terms of
 *  the three income arrays, which is the honest way to state most of them, so
 *  the wrapper does what the page does before handing them over. */
function DividendCalendarGrid({
  retroactive = [],
  announced = [],
  projected = [],
  ...rest
}: {
  retroactive?: RetroactiveIncomeRowDTO[];
  announced?: AnnouncedDividendDTO[];
  projected?: ProjectedIncomeRowDTO[];
} & Omit<React.ComponentProps<typeof Grid>, "events" | "bounds">) {
  const now = new Date();
  const events = [
    ...buildCalendarEvents(retroactive, announced, projected, iso(now)).values(),
  ].flat();
  return <Grid events={events} bounds={paymentYearBounds(events, now)} {...rest} />;
}

describe("DividendCalendarGrid", () => {
  it("plots paid events on the payment date, not the ex-date", () => {
    render(
      <DividendCalendarGrid
        retroactive={[paid]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    // Event chip visible in July view
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("marks estimated payment dates with a tilde", () => {
    render(
      <DividendCalendarGrid
        retroactive={[{ ...paid, paymentDate: "2026-07-21", paymentDateEstimated: true }]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    expect(screen.getByText(/~\$2\.71/)).toBeInTheDocument();
  });

  it("encodes status as ink density: filled paid, outlined announced, dashed projected", () => {
    render(
      <DividendCalendarGrid
        retroactive={[paid]}
        announced={[announced]}
        projected={[projectedLow]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    const paidChip = screen.getByText("O").closest("[data-status]")!;
    const annChip = screen.getByText("ORCHRD").closest("[data-status]")!;
    const projChip = screen.getByText("HIVAR").closest("[data-status]")!;
    expect(paidChip.className).toContain("bg-certainty-paid");
    expect(annChip.className).toContain("border-certainty-confirmed-border");
    expect(projChip.className).toContain("border-dashed");
    expect(projChip.className).toContain("opacity-6"); // low-confidence modifier (opacity-65)
  });

  it("opens a detail popover with date chain, figures, and asset link on chip click", async () => {
    const user = userEvent.setup();
    render(
      <DividendCalendarGrid
        retroactive={[]}
        announced={[announced]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    await user.click(screen.getByRole("button", { name: /ORCHRD/ }));
    // status line
    expect(
      screen.getByText("Confirmed", { selector: "[data-popover-status]" }),
    ).toBeInTheDocument();
    // date chain — all four stops labeled
    expect(screen.getByText("Declared")).toBeInTheDocument();
    expect(screen.getByText("Ex-div")).toBeInTheDocument();
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(screen.getByText("Paid", { selector: "[data-chain-label]" })).toBeInTheDocument();
    expect(screen.getByText("2026-06-20")).toBeInTheDocument();
    // figures
    expect(screen.getByText(/0\.075/)).toBeInTheDocument();
    expect(screen.getByText(/56/)).toBeInTheDocument();
    // asset link
    expect(screen.getByRole("link", { name: /View ORCHRD/ })).toHaveAttribute(
      "href",
      "/asset/ORCHRD",
    );
  });

  it("renders — for missing dates on paid rows", async () => {
    const user = userEvent.setup();
    render(
      <DividendCalendarGrid
        retroactive={[paid]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^O / }));
    // paid rows have no declared/record dates → two dashes in the chain
    expect(screen.getAllByText("—", { selector: "[data-chain-date]" })).toHaveLength(2);
  });

  it("marks a retroactive row as paid when its payment date has already passed", () => {
    const pastPaymentDate = addDays(new Date(), -10);
    const pastRow = {
      ...paid,
      exDate: iso(addDays(pastPaymentDate, -15)),
      paymentDate: iso(pastPaymentDate),
    };
    render(
      <DividendCalendarGrid retroactive={[pastRow]} projected={[]} initialDate={pastPaymentDate} />,
    );
    const chip = screen.getByText("O").closest("[data-status]")!;
    expect(chip.getAttribute("data-status")).toBe("paid");
    expect(chip.className).toContain("bg-certainty-paid");
  });

  it("marks a retroactive row with a future payment date as announced/confirmed, not paid", () => {
    const futurePaymentDate = addDays(new Date(), 10);
    const futureRow = {
      ...paid,
      exDate: iso(addDays(futurePaymentDate, -15)),
      paymentDate: iso(futurePaymentDate),
    };
    render(
      <DividendCalendarGrid
        retroactive={[futureRow]}
        projected={[]}
        initialDate={futurePaymentDate}
      />,
    );
    const chip = screen.getByText("O").closest("[data-status]")!;
    expect(chip.getAttribute("data-status")).toBe("announced");
    expect(chip.className).toContain("border-certainty-confirmed-border");
    expect(chip.className).not.toContain("bg-certainty-paid");
  });

  it("supports controlled month via viewDate prop", () => {
    render(
      <DividendCalendarGrid
        retroactive={[paid]}
        projected={[]}
        viewDate={new Date("2026-09-01T00:00:00Z")}
        onViewDateChange={() => {}}
      />,
    );
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
  });

  // Task 3: yield line, status filter
  const announcedTaskThree = {
    symbol: "DKKB",
    name: "Cash account",
    declarationDate: null,
    exDate: "2026-07-30",
    recordDate: null,
    paymentDate: "2026-07-30",
    paymentDateEstimated: false,
    amountPerShare: "193.88",
    shares: "1",
    income: "193.88",
    currency: "DKK",
  };

  const projectedTaskThree = {
    symbol: "KESTRL",
    name: "Kestrel Capital",
    projectedExDate: "2026-07-31",
    paymentDate: "2026-07-31",
    paymentDateEstimated: true,
    confidence: "low" as const,
    amountPerShare: "0.99",
    shares: "10",
    income: "10.31",
    currency: "DKK",
  };

  it("shows a holding's yield % on its day card", () => {
    render(
      <DividendCalendarGrid
        retroactive={[]}
        projected={[]}
        announced={[announcedTaskThree]}
        viewDate={new Date(2026, 6, 1)}
        yieldBySymbol={new Map([["DKKB", 2.36]])}
      />,
    );
    expect(screen.getByText("2.36%")).toBeInTheDocument();
  });

  it("hides events whose status is filtered out and recomputes the day total", () => {
    render(
      <DividendCalendarGrid
        retroactive={[]}
        projected={[projectedTaskThree]}
        announced={[announcedTaskThree]}
        viewDate={new Date(2026, 6, 1)}
        activeStatuses={new Set(["announced"])}
      />,
    );
    expect(screen.getByText("DKKB")).toBeInTheDocument();
    expect(screen.queryByText("KESTRL")).not.toBeInTheDocument();
    // Day-total badges recompute over visible events: DKKB's day keeps its
    // total; KESTRL's day (its only event filtered out) has no badge.
    expect(screen.getByText(/\+DKK\s*194/)).toBeInTheDocument(); // 193.88 → "+DKK 194"
    expect(screen.queryByText(/\+DKK\s*10\b/)).not.toBeInTheDocument(); // KESTRL's "+DKK 10" gone
  });

  it("omits the per-share line when the row has no per-share figure", async () => {
    const user = userEvent.setup();
    render(
      <DividendCalendarGrid
        retroactive={[
          {
            symbol: "AAPL",
            name: "Apple",
            exDate: "2026-07-10",
            paymentDate: "2026-07-10",
            paymentDateEstimated: false,
            amountPerShare: null,
            sharesHeld: null,
            income: "3.30",
            currency: "DKK",
          },
        ]}
        projected={[]}
        announced={[]}
        viewDate={new Date(2026, 6, 15)}
        onViewDateChange={() => {}}
      />,
    );
    // Open the popover to check its content
    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    // The income figure still renders in the popover
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("Income").closest("div")?.textContent).toContain("3.30");
    // Per share and Shares rows are not rendered
    expect(screen.queryByText(/per share/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^shares$/i)).not.toBeInTheDocument();
  });

  // The header pill and the day badge used to hand-roll their own money
  // grammar instead of going through lib/format.ts — the header showed full
  // precision, the day badge whole units, and both kept a leading "+" that
  // the shared formatters don't add on their own.
  it("formats the header pill and day badge through the shared money formatters", () => {
    render(
      <DividendCalendarGrid
        retroactive={[paid]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    // Day badge: whole units via formatMoneyWhole, "+" preserved.
    expect(screen.getByText("+$3")).toBeInTheDocument();
    // Header pill: full precision via formatMoney, "+" preserved.
    expect(screen.getByTestId("calendar-header-total")).toHaveTextContent("+$2.71");
  });

  // The day badge reads `events[0]?.currency`, which formatMoneyWhole would
  // hand straight to Intl.NumberFormat — and an empty currency code throws a
  // RangeError there, which is exactly how /dividends white-screened before.
  // The event chip reads the same event's currency, so a row missing one
  // risks the same crash in both places.
  it("renders dashes rather than throwing when a day's events carry no currency", () => {
    render(
      <DividendCalendarGrid
        retroactive={[{ ...paid, currency: "" }]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    // The chip's own income line and the day badge both fall back to a dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  // FX-incomplete leaves some rows in their native currency while the rest
  // convert to the display currency — the day badge and header pill used to
  // add the two together and label the sum with whichever currency came
  // first. Both chips still render their own (correct) amounts; only the
  // rolled-up figures are withheld.
  it("shows a dash on the day badge when a day's payments mix currencies", () => {
    render(
      <DividendCalendarGrid
        retroactive={[paid, { ...paid, symbol: "AAPL", name: "Apple", currency: "DKK" }]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    // Both chips render their own currency correctly.
    expect(screen.getByText("$2.71")).toBeInTheDocument();
    expect(screen.getByText(/DKK\s*2\.71/)).toBeInTheDocument();
    // The day badge — the rolled-up figure — is withheld.
    const dayNumber = screen.getByText("1", { selector: "span" });
    const cell = dayNumber.closest<HTMLElement>("[class*='min-h-']")!;
    expect(within(cell).getByText("—")).toBeInTheDocument();
  });

  it("shows a dash on the header pill when a month's payments mix currencies", () => {
    render(
      <DividendCalendarGrid
        retroactive={[
          paid,
          { ...paid, symbol: "AAPL", name: "Apple", currency: "DKK", paymentDate: "2026-07-15" },
        ]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    expect(screen.getByTestId("calendar-header-total")).toHaveTextContent("—");
  });

  it("no longer offers the one-year-ahead shortcut the picker replaced", () => {
    render(<DividendCalendarGrid retroactive={[paid]} projected={[]} />);
    expect(screen.queryByText(/one year ahead/i)).not.toBeInTheDocument();
  });

  it("no longer offers a Month/Year zoom or its own year picker", () => {
    render(<DividendCalendarGrid retroactive={[paid]} projected={[]} />);
    // Both moved: the year picker to the page, the year view to the bars.
    expect(screen.queryByRole("radio", { name: /^year$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^month$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Year")).not.toBeInTheDocument();
  });

  // A tab left open across midnight must move the "today" highlight on its
  // own re-render, not only after a reload. Days 15/16 of the current
  // month/year keep this relative to the real clock (no self-expiring
  // absolute date) while guaranteeing both days exist in any month and
  // never straddle a month boundary.
  it("moves the today highlight across a midnight boundary without a reload", () => {
    const base = new Date();
    const day1 = new Date(base.getFullYear(), base.getMonth(), 15, 23, 50, 0);
    const day2 = new Date(base.getFullYear(), base.getMonth(), 16, 0, 10, 0);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(day1);
      const { rerender } = render(<DividendCalendarGrid retroactive={[]} projected={[]} />);

      // Asserted through `data-today`, not through the marker's colour class.
      // This test is about WHICH day is marked; it used to check for
      // `bg-primary` and so failed the moment the marker stopped being sage,
      // reporting a styling change as a broken midnight boundary.
      expect(screen.getByText("15", { selector: "span" })).toHaveAttribute("data-today");

      vi.setSystemTime(day2);
      rerender(<DividendCalendarGrid retroactive={[]} projected={[]} />);

      expect(screen.getByText("16", { selector: "span" })).toHaveAttribute("data-today");
      expect(screen.getByText("15", { selector: "span" })).not.toHaveAttribute("data-today");
    } finally {
      vi.useRealTimers();
    }
  });

  // Task 5: type hierarchy and height. Measured against Snowball on
  // 2026-08-23: their cell runs 14/13/12/13/13px across five elements; ours
  // was text-xs (12px) for all five, which is why the cell read dense rather
  // than composed.
  it("gives the day cell a type hierarchy rather than one size for everything", () => {
    render(
      <DividendCalendarGrid
        retroactive={[]}
        announced={[announced]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    // The day number and the chip's amount lead; the ticker and yield support
    // them. All five at text-xs is what made the cell look cramped.
    const amount = screen.getByText("$4.20");
    expect(amount.className).toContain("text-sm");
    expect(amount.className).not.toContain("text-xs");
  });

  it("keeps two payments on one day inside their cell", () => {
    // The height went up because a day with two payments packed against the
    // floor. jsdom cannot measure, so this guards the structure: both chips
    // land in the same min-h-40 cell. The 375px browser check (deferred)
    // covers the actual geometry.
    render(
      <DividendCalendarGrid
        retroactive={[paid, { ...paid, symbol: "AAPL", name: "Apple", income: "3.30" }]}
        projected={[]}
        initialDate={new Date("2026-07-01T00:00:00Z")}
      />,
    );
    const cell = screen.getByText("AAPL").closest<HTMLElement>("[class*='min-h-']")!;
    expect(cell.className).toContain("min-h-40");
    expect(within(cell).getByText("O")).toBeInTheDocument();
  });
});
