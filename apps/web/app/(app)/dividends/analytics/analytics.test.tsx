import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen, waitFor, cleanup, within } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../../lib/test/render-with-client";
import { qk } from "../../../../lib/query/keys";
import type { DividendIncomeDTO, PortfolioDTO } from "../../../../lib/types";

vi.mock("../../../../lib/api", () => ({
  getDividendIncome: vi.fn(),
  getPortfolio: vi.fn(),
}));

// Import after the mock above so the page's transitive deps (incl. the
// dividend-tax hooks) pick it up.
import DividendAnalyticsPage from "./page";

// GROSS payload, as the wire format always is — the hook nets it internally.
// A future payment date, computed relatively so this fixture never rots into
// a past date (see the self-expiring-tests hazard).
const UPCOMING_PAYMENT_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
})();

// A month ago, computed relatively for the same reason as
// UPCOMING_PAYMENT_DATE — this needs to fall inside `monthlyRhythm`'s
// trailing-12-month window on whatever day the suite runs.
const RECENT_PAYMENT_DATE = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
})();

const LAST_CALENDAR_YEAR = String(new Date().getFullYear() - 1);

const GROSS_INCOME: DividendIncomeDTO = {
  retroactive: [
    {
      symbol: "O",
      name: "Realty Income",
      exDate: RECENT_PAYMENT_DATE,
      paymentDate: RECENT_PAYMENT_DATE,
      paymentDateEstimated: false,
      amountPerShare: "0.26",
      sharesHeld: "10",
      income: "2.60",
      currency: "USD",
    },
  ],
  projected: [],
  announced: [
    {
      symbol: "O",
      name: "Realty Income",
      declarationDate: null,
      exDate: UPCOMING_PAYMENT_DATE,
      recordDate: null,
      paymentDate: UPCOMING_PAYMENT_DATE,
      paymentDateEstimated: false,
      amountPerShare: "0.26",
      shares: "10",
      income: "2.60",
      currency: "USD",
    },
  ],
  perHolding: [
    {
      symbol: "O",
      forwardAnnualIncome: { amount: "100.00", currency: "USD" },
      incomeShare: 1,
      cagr5y: null,
      trend: "unknown",
    },
  ],
  summary: {
    trailingTwelveMonthIncome: [{ amount: "1000.00", currency: "USD" }],
    projectedTwelveMonthIncome: [{ amount: "1000.00", currency: "USD" }],
    monthlyBreakdown: [],
    // A finished year, so IncomeTimeline has a column to draw — otherwise
    // `points` comes back empty and the whole card renders null (see
    // `incomeTimeline`'s doc comment), taking the invariant test's own
    // anchor text ("Income by year") down with it.
    receivedByYear: [{ year: LAST_CALENDAR_YEAR, amount: "500.00", currency: "USD" }],
  },
  incomeByGroup: { holdings: [], sector: [], currency: [] },
  dividendTaxRate: 35,
  fxIncomplete: false,
  incomeRecordingOff: false,
};

const PORTFOLIO: PortfolioDTO = {
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
      currentPrice: { amount: "100", currency: "USD" },
      marketValue: { amount: "1000", currency: "USD" },
      unrealizedGainLoss: { amount: "450", currency: "USD" },
      gainLossPercent: 81.8,
      dailyChange: null,
      dailyChangePercent: null,
      dividendIncome: null,
      totalReturn: null,
      totalReturnPercent: null,
      website: null,
      // Non-null on purpose: yieldOnCost: null was masking the fact that
      // "Yield on cost" (both the Yield card's "On cost" slot and the
      // Holdings table column) was never netted, even on this after-tax page.
      yieldOnCost: 0.08,
      basisMismatch: null,
    },
  ],
  subtotalsByCurrency: [
    {
      currency: "USD",
      costBasis: { amount: "550", currency: "USD" },
      marketValue: { amount: "1000", currency: "USD" },
      gainLoss: { amount: "450", currency: "USD" },
    },
  ],
};

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO;
  }
});

describe("DividendAnalyticsPage — Yield card gross/net", () => {
  it("recovers a true gross figure from the netted payload, alongside the net headline", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());

    // Gross forward yield = 100 / 1000 * 100 = 10%, computed from the raw
    // (un-netted) payload the hook exposes as `gross`.
    expect(screen.getByText("10.00%")).toBeInTheDocument(); // "Before tax" slot
    // Net headline = 10% * (1 - 0.35) = 6.5%.
    expect(screen.getByTestId("yield-net")).toHaveTextContent("6.50%");
  });

  it("nets yield on cost too — both the Yield card's 'On cost' slot and the Holdings table column", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());

    // Position yieldOnCost = 0.08 (8%, gross) × factor 0.65 = 5.2%.
    // Yield card ("On cost" slot, 2 decimals):
    expect(screen.getByText("5.20%")).toBeInTheDocument();
    // Holdings table ("Yield on cost" column, 1 decimal):
    expect(screen.getByTestId("yield-on-cost")).toHaveTextContent("5.2%");
  });

  it("renders netted annual-income and cash-flow figures", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());

    // Forward 12m income = 1000 gross × 0.65 = 650.
    expect(screen.getByTestId("annual-income")).toHaveTextContent("$650");
    // Cash flow monthly avg = 650 / 12 = 54.17 → rounds to $54 (whole-figure display).
    expect(screen.getByText("$54")).toBeInTheDocument();
  });

  it("renders a real gross figure and a 0% net figure at a 100% tax rate — never NaN", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), { ...GROSS_INCOME, dividendTaxRate: 100 });
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());

    // Gross forward yield is unaffected by the tax rate — still 10%. Computing
    // it from the raw `gross` payload (rather than dividing the netted figure
    // by `factor`, which is 0 at a 100% rate) is what keeps this a real number.
    expect(screen.getByText("10.00%")).toBeInTheDocument(); // "Before tax" slot
    // Net headline = 10% × (1 - 1) = 0%.
    expect(screen.getByTestId("yield-net")).toHaveTextContent("0.00%");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("does not set a single-letter ticker in mono", async () => {
    // "O" (Realty Income) in Geist Mono is indistinguishable from a zero, so the
    // cash-flow rows read "0 · Sep 15". Ticker identity is not a data figure.
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());

    const ticker = screen.getByTestId("cashflow-symbol-O");
    expect(ticker.className).not.toMatch(/font-mono/);
  });

  it("shows the FX-unavailable banner only when fxIncomplete is set", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());
    expect(
      screen.queryByText(/Exchange rates are temporarily unavailable/),
    ).not.toBeInTheDocument();

    cleanup();

    const qc2 = makeTestQueryClient();
    qc2.setQueryData(qk.dividendIncome(), { ...GROSS_INCOME, fxIncomplete: true });
    qc2.setQueryData(qk.portfolio(), PORTFOLIO);

    renderWithClient(<DividendAnalyticsPage />, qc2);

    await waitFor(() => expect(screen.getByText("Dividend analytics")).toBeInTheDocument());
    expect(screen.getByText(/Exchange rates are temporarily unavailable/)).toBeInTheDocument();
  });

  // What this test can and cannot see under jsdom: Recharts never lays out
  // its SVG here (`ResponsiveContainer` measures 0×0), so money drawn only
  // inside a `LabelList`/chart never reaches `textContent` — `income-timeline`
  // and `monthly-rhythm` are invisible to the /DKK|\$|€/ filter below no
  // matter what their chip does, and `yield-by-holding` never renders a
  // currency symbol at all (percentage only). In this fixture `moneyCards`
  // collapses to `forward-payments` alone, because its figure is plain
  // subtitle text outside the chart. That is real coverage for one card, not
  // four — the other three are covered instead by the dedicated
  // `renders the basis chip when taxed` tests in `income-timeline.test.tsx`,
  // `monthly-rhythm.test.tsx`, and `yield-by-holding.test.tsx`, which assert
  // directly on the `CardTitle` row (plain DOM, no Recharts involved) and so
  // do not share this blind spot. Treat this test as the invariant for
  // whatever it can actually observe, not as proof the other three are
  // covered.
  it("shows a basis marker on every card that renders a money figure", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.dividendIncome(), GROSS_INCOME);
    qc.setQueryData(qk.portfolio(), PORTFOLIO);

    const { container } = renderWithClient(<DividendAnalyticsPage />, qc);
    // Every chart card on this page (IncomeComposition, IncomeTimeline,
    // ForwardPayments, GrowthLeaders, YieldByHolding, MonthlyRhythm) is
    // behind `next/dynamic(..., { ssr: false })` — a separate lazy import
    // that resolves on its own microtask, not necessarily on the same tick
    // as its siblings. Waiting on one anchor string (as this test originally
    // did) proved to be a real, reproducible flake: `ForwardPayments` and
    // `GrowthLeaders` were still showing their `ChartSkeleton` fallback —
    // absent from `cards` entirely — in roughly 3 of 4 runs even though
    // `IncomeTimeline` had already mounted. Waiting for every skeleton to
    // clear as well, not just one title, makes the snapshot below wait for
    // the whole grid rather than whichever card happened to win the race.
    //
    // Six independent lazy imports resolving is reachable well within
    // testing-library's default 1000ms in isolation, but under a fully
    // loaded suite (the whole monorepo running concurrently) the shared CPU
    // can push that past the default and fail this test with the KPI row
    // rendered but the chart cards' skeletons still up — confirmed by
    // reproducing it under artificial CPU contention. The condition itself
    // is unchanged and still reachable; it just needs more real time than
    // the default budget allows when the machine is busy.
    await waitFor(
      () => {
        expect(screen.getByText(/Income by year/)).toBeInTheDocument();
        expect(screen.queryAllByRole("status", { name: "Loading chart" })).toHaveLength(0);
      },
      { timeout: 5000 },
    );

    const cards = Array.from(container.querySelectorAll("[data-card]"));
    // Guard the guard: an empty NodeList would make the loop below pass
    // vacuously, which is how an invariant test silently stops testing.
    expect(cards.length).toBeGreaterThan(3);

    // Explicit id list, not a prefix match: `startsWith("kpi-card-")` would
    // silently exempt any *future* money card added under that same
    // established naming convention, even one that forgot a chip entirely —
    // exactly the failure mode this invariant exists to catch. Naming the
    // two known exemptions here means a new `kpi-card-*` card fails loudly
    // instead of inheriting a free pass by being named consistently.
    const KPI_CARDS_WITHOUT_A_CHIP = ["kpi-card-income", "kpi-card-cashflow"];

    const moneyCards = cards.filter((c) => {
      const el = c as HTMLElement;
      // kpi-cards.tsx's top KPI row (Annual income / Yield / Cash flow) is a
      // separate, pre-existing component not among the six files Task 9
      // names — see the task report. YieldCard already states its own basis
      // inline ("Before tax"/net), but AnnualIncomeCard and CashFlowCard show
      // money with no basis text outside a closed InfoTooltip, so applying
      // this invariant to them would fail on a card this task was never
      // asked to touch. Excluded explicitly, not silently: extending those
      // two cards is flagged as an open gap for a follow-up task.
      if (KPI_CARDS_WITHOUT_A_CHIP.includes(el.dataset.testid ?? "")) return false;
      // The consolidated Holdings table (`holdings-dividend-table.tsx`) is a
      // per-row readable-row grid, not a `CardTitle`-headlined bento tile —
      // a different, already-established DESIGN.md contract (RowGrid/
      // DataRow) that this task's "same corner on every card" marker was
      // never meant to sit inside. Identified structurally (it renders rows
      // carrying this testid) rather than by title text, which would rot.
      if (el.querySelector('[data-testid="holding-row"]')) return false;
      return /DKK|\$|€/.test(el.textContent ?? "");
    });
    expect(moneyCards.length).toBeGreaterThan(0);

    for (const card of moneyCards) {
      expect(within(card as HTMLElement).getByText(/After tax|Before tax/)).toBeInTheDocument();
    }
  });
});
