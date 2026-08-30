import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { DividendIncomeDTO, PortfolioDTO } from "../../../lib/types";

vi.mock("../../../lib/api", () => ({
  getDividendIncome: vi.fn(),
  getPortfolio: vi.fn(),
  syncDividends: vi.fn(),
}));

// Import after the mocks above so DividendsPage's transitive deps pick them up.
import DividendsPage from "./page";
import * as api from "../../../lib/api";

// The calendar view defaults to the current real month (DividendsPage seeds
// `calendarDate` from `new Date()`), and only renders events whose date falls
// in that month/year grid. An absolute fixture date (e.g. a hardcoded
// "2026-07-15") only renders while the suite happens to run in that month —
// exactly the self-expiring-test trap this task's item 7 fixes elsewhere.
// "ORCHRD"'s paymentDate is pinned to today so it is always in view.
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const mainPaymentDate = isoDate(today);
// Detail-only fields (shown in a popover, not used to place the calendar
// cell) — need not stay within the current month.
const mainDeclarationDate = isoDate(
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - 19),
);
const mainExDate = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7));
const mainRecordDate = isoDate(
  new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6),
);
// `yearProgressFromEvents` (consumed by YearSummary) buckets events by year,
// so a hardcoded "2026-06" would only fall in the current year while the suite
// happens to run in 2026 — the same self-expiring-fixture trap the payment
// dates above already dodge. Pin it to the current month instead.
const currentBreakdownMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
// The summary band now reads the row arrays rather than `monthlyBreakdown`, so
// this row's own date decides whether it lands in the selected year. January
// 1st of the current year is the one date that is always both in-year and in
// the past, whenever the suite runs.
const paidThisYear = `${today.getFullYear()}-01-01`;

const FIXTURE_INCOME: DividendIncomeDTO = {
  retroactive: [
    {
      symbol: "O",
      name: "Realty Income",
      exDate: paidThisYear,
      paymentDate: paidThisYear,
      paymentDateEstimated: false,
      amountPerShare: "0.271",
      sharesHeld: "10",
      income: "2.71",
      currency: "USD",
    },
  ],
  projected: [],
  announced: [
    {
      symbol: "ORCHRD",
      name: "Orchard Capital",
      declarationDate: mainDeclarationDate,
      exDate: mainExDate,
      recordDate: mainRecordDate,
      paymentDate: mainPaymentDate,
      paymentDateEstimated: false,
      amountPerShare: "0.075",
      shares: "56",
      income: "4.20",
      currency: "USD",
    },
  ],
  perHolding: [],
  summary: {
    trailingTwelveMonthIncome: [{ amount: "120.00", currency: "USD" }],
    projectedTwelveMonthIncome: [{ amount: "130.00", currency: "USD" }],
    monthlyBreakdown: [
      {
        month: currentBreakdownMonth,
        retroactive: "10.00",
        announced: "0",
        projected: "0",
        currency: "USD",
      },
    ],
    receivedByYear: [],
  },
  incomeByGroup: { holdings: [], sector: [], currency: [] },
  dividendTaxRate: null,
  fxIncomplete: false,
  incomeRecordingOff: false,
};

const FIXTURE_PORTFOLIO: PortfolioDTO = {
  positions: [
    {
      symbol: "O",
      name: "Realty Income",
      exchange: "NYSE",
      currency: "USD",
      nativeCurrency: "USD",
      quantity: "10",
      averageCost: { amount: "55", currency: "USD" },
      costBasis: { amount: "550", currency: "USD" },
      currentPrice: { amount: "58", currency: "USD" },
      marketValue: { amount: "580", currency: "USD" },
      unrealizedGainLoss: { amount: "30", currency: "USD" },
      gainLossPercent: 5.45,
      dailyChange: { amount: "1", currency: "USD" },
      dailyChangePercent: 0.5,
      dividendIncome: null,
      totalReturn: null,
      totalReturnPercent: null,
      website: null,
      yieldOnCost: 5.9,
      basisMismatch: null,
    },
  ],
  subtotalsByCurrency: [
    {
      currency: "USD",
      costBasis: { amount: "550", currency: "USD" },
      marketValue: { amount: "580", currency: "USD" },
      gainLoss: { amount: "30", currency: "USD" },
    },
  ],
};

/** Stub the viewport query the page asks on mount.
 *
 *  Through `vi.stubGlobal`, never by assigning `window.matchMedia` directly:
 *  a direct assignment is never restored, so the last test to call this leaks
 *  its viewport into every test that runs after it in the same file. */
function setViewportIsPhone(isPhone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isPhone && /max-width:\s*767px/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("DividendsPage", () => {
  it("renders seeded cache data without refetching income or portfolio", async () => {
    const incomeSpy = vi.spyOn(api, "getDividendIncome");
    const portfolioSpy = vi.spyOn(api, "getPortfolio");

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), FIXTURE_INCOME);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.getAllByText("ORCHRD").length).toBeGreaterThan(0);
    expect(incomeSpy).not.toHaveBeenCalled();
    expect(portfolioSpy).not.toHaveBeenCalled();
  });

  it("nets the year-progress figures when a dividend tax rate is configured", async () => {
    // The fixture's two in-year payments are $2.71 + $4.20 = $6.91 gross; at a
    // 35% flat tax rate the netted total must be $4.49 ($6.91 * 0.65). This is
    // the page's own transform (via useNetDividendIncome, which nets the row
    // arrays before the calendar events are ever built), but nothing else in
    // this suite exercises a non-null dividendTaxRate — without this test the
    // netting could be deleted from the page entirely and the whole suite
    // would still pass.
    const taxedIncome: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      dividendTaxRate: 35,
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), taxedIncome);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.getByTestId("year-total")).toHaveTextContent("$4.49");
  });

  // The page white-screened here: with no row for the current year
  // `yearProgress` returned an empty currency, and YearSummary fed that
  // straight to Intl.NumberFormat, which throws `RangeError: Invalid currency
  // code :`. Three ordinary states reach it — a first run before the first
  // dividend sync, a portfolio with no dividend payers, and an FX outage that
  // filters every row out — and the component sits outside the guard the
  // chart below it has.
  it("renders with no monthly breakdown at all instead of throwing", async () => {
    const empty: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      retroactive: [],
      announced: [],
      summary: { ...FIXTURE_INCOME.summary, monthlyBreakdown: [], receivedByYear: [] },
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), empty);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    // The summary band renders, with a dash where the hero figure would be.
    expect(screen.getByTestId("year-total")).toHaveTextContent("—");
    // And the sibling that already handled the empty case still does.
    expect(screen.getByText(`No income recorded for ${today.getFullYear()}.`)).toBeInTheDocument();
  });

  // The FX-incomplete state is exactly where the two populations came apart:
  // the API drops rows conversion could not reach from `monthlyBreakdown`
  // while leaving them in the row arrays. The band used to read the emptied
  // payload and describe a portfolio the list below it contradicted. It reads
  // the rows now, so it shows the same $6.91 the list does — and still must
  // not crash under the callout.
  it("keeps the band on the rows the list shows when FX emptied the breakdown", async () => {
    const fxOut: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      fxIncomplete: true,
      summary: { ...FIXTURE_INCOME.summary, monthlyBreakdown: [], receivedByYear: [] },
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), fxOut);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.getByText(/exchange rate/i)).toBeInTheDocument();
    expect(screen.getByTestId("year-total")).toHaveTextContent("$6.91");
  });

  // And when those rows genuinely disagree on a currency there is no honest
  // figure to show, so the band withholds it rather than adding DKK to USD.
  it("withholds the year total when the rows do not share one currency", async () => {
    const mixed: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      fxIncomplete: true,
      retroactive: [{ ...FIXTURE_INCOME.retroactive[0]!, currency: "DKK", income: "100.00" }],
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), mixed);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.getByTestId("year-total")).toHaveTextContent("—");
  });

  // The header used to carry its own "Analytics" outline button, and the
  // summary band later carried a second one — both redundant with the
  // Dividends nav group (Calendar + Analytics), which is the sidebar's job,
  // not this page's. This page renders neither; reachability is the nav's.
  it("does not duplicate the sidebar's Analytics link on the page itself", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), FIXTURE_INCOME);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /analytics/i })).not.toBeInTheDocument();
  });

  it("invalidates the dividend-sync cache families after a successful sync", async () => {
    vi.mocked(api.syncDividends).mockResolvedValueOnce({});
    vi.mocked(api.getDividendIncome).mockResolvedValue(FIXTURE_INCOME);
    vi.mocked(api.getPortfolio).mockResolvedValue(FIXTURE_PORTFOLIO);

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), FIXTURE_INCOME);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    renderWithClient(<DividendsPage />, qc);
    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Re-sync dividends" }));

    await waitFor(() => expect(api.syncDividends).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dividend-income"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  // The chart's empty state was guarded on the WHOLE payload while its copy
  // named the selected year, so picking an empty year while another year had
  // income drew twelve zero bars instead of saying so.
  it("says a picked year has no income rather than drawing twelve zero bars", async () => {
    const user = userEvent.setup();
    const emptyYear = today.getFullYear() - 1;
    const income: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      // A paid payment in the empty year, so the picker offers it — but no
      // breakdown row for it, which is the state that used to slip through.
      retroactive: [
        ...FIXTURE_INCOME.retroactive,
        {
          ...FIXTURE_INCOME.retroactive[0]!,
          exDate: `${emptyYear}-07-01`,
          paymentDate: `${emptyYear}-07-01`,
        },
      ],
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), income);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    const picker = await screen.findByLabelText("Year");
    // The current year does have a breakdown row, so it charts.
    expect(screen.getByTitle(new RegExp(`^${currentBreakdownMonth}:`))).toBeInTheDocument();

    await user.selectOptions(picker, String(emptyYear));
    expect(screen.getByText(`No income recorded for ${emptyYear}.`)).toBeInTheDocument();
    expect(screen.queryByTitle(new RegExp(`^${emptyYear}-01:`))).not.toBeInTheDocument();
  });

  // The grid used to run `buildCalendarEvents` and `paymentYearBounds` over
  // the same props the page already had, so the stepper's clamp and the
  // picker's options were two derivations of one invariant in two files, with
  // nothing testing that they agreed. They are one prop now, and this is the
  // test that was missing.
  it("clamps the grid's stepper to exactly the years the picker offers", async () => {
    const user = userEvent.setup();
    const thisYear = today.getFullYear();
    const nextYear = thisYear + 1;
    const income: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      summary: {
        ...FIXTURE_INCOME.summary,
        // Both years need a bar to click; the picker's span comes from the
        // payments, not from this.
        monthlyBreakdown: [
          {
            month: `${thisYear}-01`,
            retroactive: "2.71",
            announced: "0",
            projected: "0",
            currency: "USD",
          },
          {
            month: `${nextYear}-06`,
            retroactive: "0",
            announced: "0",
            projected: "5.00",
            currency: "USD",
          },
        ],
        receivedByYear: [],
      },
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), income);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    const picker = await screen.findByLabelText("Year");
    const offered = [...picker.querySelectorAll("option")].map((o) => o.value);
    expect(offered).toEqual([String(thisYear), String(nextYear)]);

    // The first offered year's January is the floor: the grid must refuse to
    // step below a year the picker cannot select.
    await user.click(screen.getByTitle(new RegExp(`^${thisYear}-01:`)));
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    // …and the last offered year's December is the ceiling.
    await user.selectOptions(picker, String(nextYear));
    await user.click(screen.getByTitle(new RegExp(`^${nextYear}-12:`)));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  // `calendarDate` is the one source of truth for both the page's year picker
  // and the grid's month — there is deliberately no second `selectedYear`
  // state that could disagree with it. A fixture year is derived relative to
  // the real clock (never a hardcoded absolute year) so this does not join
  // the self-expiring fixtures that have turned main red before.
  it("changes the year for the whole page, carrying the month with it", async () => {
    const user = userEvent.setup();
    const targetYear = new Date().getFullYear() - 1;
    // A paid payment in the target year, so the page's picker offers it.
    const olderPaid = {
      ...FIXTURE_INCOME.retroactive[0]!,
      exDate: `${targetYear}-06-30`,
      paymentDate: `${targetYear}-07-01`,
    };
    const income: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      retroactive: [...FIXTURE_INCOME.retroactive, olderPaid],
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), income);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);

    // The grid's month label must land in the newly picked year rather than
    // staying behind — a summary showing one year above a grid showing
    // another is the failure this guards.
    const picker = await screen.findByLabelText("Year");
    const target = String(targetYear);
    await user.selectOptions(picker, target);

    // `{ selector: "span" }` targets the grid's own month label, not the
    // picker's `<option>` — both carry the target year's text, and only the
    // label proves the grid actually moved with the picker.
    expect(screen.getByText(new RegExp(target), { selector: "span" })).toBeInTheDocument();
  });

  // A tooltip must not disagree with itself: its dollar total and its payer
  // count answer the same filter, so they move together or not at all. They
  // used to move apart in both directions — first the count filtered while the
  // total did not, and once the total started filtering, the count had to
  // follow it back. "THAMES.L" is a placeholder LSE ticker (see CLAUDE.md's
  // test-fixture convention), not a real holding.
  it("moves a month's dollar total and payer count together when a status is off", async () => {
    const user = userEvent.setup();
    const projectedPaymentDate = `${currentBreakdownMonth}-15`;
    const income: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      retroactive: [],
      announced: [],
      projected: [
        {
          symbol: "THAMES.L",
          name: "Thames Test PLC",
          projectedExDate: projectedPaymentDate,
          paymentDate: projectedPaymentDate,
          paymentDateEstimated: false,
          confidence: "high",
          amountPerShare: "0.50",
          shares: "10",
          income: "5.00",
          currency: "USD",
        },
      ],
      summary: {
        ...FIXTURE_INCOME.summary,
        monthlyBreakdown: [
          {
            month: currentBreakdownMonth,
            retroactive: "0",
            announced: "0",
            projected: "5.00",
            currency: "USD",
          },
        ],
        receivedByYear: [],
      },
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), income);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);
    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());

    const barTitle = () =>
      screen.getByTitle(new RegExp(`^${currentBreakdownMonth}:`)).getAttribute("title") ?? "";

    // With everything selected the two figures agree at the month's real value.
    expect(barTitle()).toContain("estimated 5.00");
    expect(barTitle()).toContain("1 payer");

    // Deselecting "Paid" touches neither: this month has no paid event to drop.
    await user.click(screen.getByRole("button", { name: /^paid$/i }));
    expect(barTitle()).toContain("estimated 5.00");
    expect(barTitle()).toContain("1 payer");

    // Deselecting "Estimated" — the status this month's own (and only) payer
    // carries — must take BOTH figures down, not one of them.
    await user.click(screen.getByRole("button", { name: /^estimated$/i }));
    expect(barTitle()).toContain("estimated 0.00");
    expect(barTitle()).not.toContain("payer");
  });

  // The invariant the whole rework exists to hold, and the one nothing tested
  // above the `groupListRows` unit level: the summary hero, the twelve bar
  // values and the list's month subtotals are one quantity in three places.
  // They were not — the first two read `monthlyBreakdown`, which the status
  // filter cannot reach, while the last read the row arrays, which it can.
  it("moves the hero, the bar and the month subtotal together on a status toggle", async () => {
    const user = userEvent.setup();
    // A phone viewport so the page opens on the list, where month subtotals
    // render. The summary band and the bars sit above the view toggle and
    // render either way, so all three layers are on screen at once.
    setViewportIsPhone(true);

    const paidDate = `${currentBreakdownMonth}-01`;
    const projectedDate = `${currentBreakdownMonth}-28`;
    const income: DividendIncomeDTO = {
      ...FIXTURE_INCOME,
      retroactive: [
        {
          symbol: "O",
          name: "Realty Income",
          exDate: paidDate,
          paymentDate: paidDate,
          paymentDateEstimated: false,
          amountPerShare: "1.00",
          sharesHeld: "10",
          income: "10.00",
          currency: "USD",
        },
      ],
      announced: [],
      projected: [
        {
          symbol: "KO",
          name: "Coca-Cola",
          projectedExDate: projectedDate,
          paymentDate: projectedDate,
          paymentDateEstimated: false,
          confidence: "high",
          amountPerShare: "0.50",
          shares: "10",
          income: "5.00",
          currency: "USD",
        },
      ],
      summary: {
        ...FIXTURE_INCOME.summary,
        monthlyBreakdown: [
          {
            month: currentBreakdownMonth,
            retroactive: "10.00",
            announced: "0",
            projected: "5.00",
            currency: "USD",
          },
        ],
        receivedByYear: [],
      },
    };

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), income);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);

    renderWithClient(<DividendsPage />, qc);
    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());

    const bar = () => screen.getByTitle(new RegExp(`^${currentBreakdownMonth}:`));

    // All three layers agree on $15.
    expect(screen.getByTestId("year-total")).toHaveTextContent("$15.00");
    expect(bar()).toHaveTextContent("15");
    expect(screen.getByTestId(`month-total-${currentBreakdownMonth}`)).toHaveTextContent("$15.00");

    await user.click(screen.getByRole("button", { name: /^estimated$/i }));

    // …and all three on $10. Any one of them staying at $15 is the defect.
    expect(screen.getByTestId("year-total")).toHaveTextContent("$10.00");
    expect(bar()).toHaveTextContent("10");
    expect(bar().getAttribute("title")).toContain("estimated 0.00");
    expect(screen.getByTestId(`month-total-${currentBreakdownMonth}`)).toHaveTextContent("$10.00");
    // The row itself is gone from the list, which is what the subtotal follows.
    expect(screen.queryByText("Coca-Cola")).not.toBeInTheDocument();
  });
});

describe("DividendsPage — which view a phone opens on", () => {
  function seeded() {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), FIXTURE_INCOME);
    qc.setQueryData(qk.portfolio(), FIXTURE_PORTFOLIO);
    return qc;
  }

  // A month grid is seven columns whatever the screen. On a 360px phone it can
  // only be shown by scrolling sideways, so the default view would be
  // something you drag to read. The list carries the same payments in one
  // column. ORCHRD's paymentDate is pinned to today, so its month section is
  // guaranteed to render for the current year — that section is the list's
  // own markup (a "month-section-YYYY-MM" testid), not the calendar grid's.
  it("opens on the list, not the sideways-scrolling calendar", async () => {
    setViewportIsPhone(true);
    renderWithClient(<DividendsPage />, seeded());

    await waitFor(() =>
      expect(screen.getByTestId(`month-section-${currentBreakdownMonth}`)).toBeInTheDocument(),
    );
  });

  it("still opens on the calendar with room to show one", async () => {
    setViewportIsPhone(false);
    renderWithClient(<DividendsPage />, seeded());

    await waitFor(() => expect(screen.getByText("Dividends")).toBeInTheDocument());
    expect(screen.queryByTestId(`month-section-${currentBreakdownMonth}`)).not.toBeInTheDocument();
  });
});
