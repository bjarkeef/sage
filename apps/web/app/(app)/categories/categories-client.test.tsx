import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../../../lib/test/render-with-client";
import { qk } from "../../../lib/query/keys";
import type { CategoriesViewDTO, CategoryNodeDTO, UserSettingsDTO } from "../../../lib/types";

let searchParams = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock("../../../lib/api", () => ({
  getCategoriesView: vi.fn(),
  getUserSettings: vi.fn(),
  saveCategories: vi.fn(),
}));

// The donut is dynamically imported and draws through recharts, which needs a
// measured container jsdom will not give it. Every assertion here is about the
// table, so stub the chart rather than sizing a canvas that proves nothing.
vi.mock("../../../components/categories/allocation-donut", () => ({
  AllocationDonut: ({ rows }: { rows: { id: string }[] }) => (
    <div data-testid="allocation-donut">{rows.length}</div>
  ),
}));

import { CategoriesClient } from "./categories-client";

const FIXTURE_SETTINGS: UserSettingsDTO = {
  name: "Test User",
  displayCurrency: "DKK",
  overviewPrefs: {
    brief: true,
    paydayGreeting: true,
    marketState: true,
    incomeRoom: true,
    portfolioRoom: true,
    statStrip: false,
    goalBand: true,
    performanceCard: true,
    incomeCard: true,
    portfolioCard: true,
    upcomingCard: true,
  },
  dividendTaxRate: null,
  autoAddDividends: true,
  allowNegativeDividendGrowth: true,
};

const money = (amount: string) => ({ amount, currency: "DKK" });

const apple = {
  symbol: "AAPL",
  name: "Apple Inc",
  website: "https://apple.com",
  value: money("35307.38"),
  invested: money("33497.18"),
  gain: money("1810.20"),
  gainPercent: 5.4,
  weightPct: 100,
  targetPct: null,
};

const nested: CategoryNodeDTO = {
  id: "cat-1a",
  name: "Big Tech",
  targetPct: 100,
  actualPct: 100,
  value: money("35307.38"),
  invested: money("33497.18"),
  gain: money("1810.20"),
  gainPercent: 5.4,
  children: [],
  holdings: [apple],
  itemCount: 1,
};

const growth: CategoryNodeDTO = {
  id: "cat-1",
  name: "Growth",
  targetPct: 40,
  actualPct: 26.51,
  value: money("35307.38"),
  invested: money("33497.18"),
  gain: money("1810.20"),
  gainPercent: 5.4,
  children: [nested],
  holdings: [],
  itemCount: 1,
};

const FIXTURE: CategoriesViewDTO = {
  root: {
    id: "root",
    name: "Portfolio",
    targetPct: null,
    actualPct: 100,
    value: money("133193.25"),
    invested: money("129887.68"),
    gain: money("3305.57"),
    gainPercent: 2.54,
    children: [growth],
    holdings: [
      {
        symbol: "BULLION",
        name: "Bullion Trust Physical Gold",
        website: null,
        value: money("6259.51"),
        invested: money("6620.14"),
        gain: money("-360.63"),
        gainPercent: -5.45,
        weightPct: 4.7,
        targetPct: 5,
      },
    ],
    itemCount: 2,
  },
  unallocated: [
    {
      symbol: "THEMEX",
      name: "Themex Big-Tech Income",
      website: null,
      value: money("1500.00"),
      invested: money("1400.00"),
      gain: money("100.00"),
      gainPercent: 7.14,
      weightPct: 1.13,
      targetPct: null,
    },
  ],
  totals: {
    value: money("133193.25"),
    invested: money("129887.68"),
    gain: money("3305.57"),
    gainPercent: 2.54,
    targetPctSum: 45,
  },
  fxIncomplete: false,
};

const EMPTY: CategoriesViewDTO = {
  root: {
    id: "root",
    name: "Portfolio",
    targetPct: null,
    actualPct: 100,
    value: money("0.00"),
    invested: money("0.00"),
    gain: money("0.00"),
    gainPercent: null,
    children: [],
    holdings: [],
    itemCount: 0,
  },
  unallocated: [],
  totals: {
    value: money("0.00"),
    invested: money("0.00"),
    gain: money("0.00"),
    gainPercent: null,
    targetPctSum: null,
  },
  fxIncomplete: false,
};

function seed(dto: CategoriesViewDTO) {
  const qc = makeTestQueryClient();
  qc.setQueryData(qk.userSettings(), FIXTURE_SETTINGS);
  qc.setQueryData(qk.categoriesView("DKK"), dto);
  return qc;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe("CategoriesClient — read mode", () => {
  it("renders one row per top-level category with actual over target", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const row = screen.getByRole("link", { name: "Growth" }).closest("tr") as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByTestId("allocation")).toHaveTextContent("26.5% / 40%");
    // Collapsed: the holding two levels down must NOT be on the page.
    expect(screen.queryByText("Apple Inc")).not.toBeInTheDocument();
  });

  it("summarises a category by its item count, not by listing its contents", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const row = screen.getByRole("link", { name: "Growth" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("1 item")).toBeInTheDocument();
  });

  it("links a category row to its own drill-down path", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    expect(screen.getByRole("link", { name: "Growth" })).toHaveAttribute(
      "href",
      "/categories?path=cat-1",
    );
  });

  it("shows the drilled-in level and a breadcrumb back up", () => {
    searchParams = new URLSearchParams("path=cat-1");
    renderWithClient(<CategoriesClient />, seed(FIXTURE));

    // One level down: Growth's child, not Growth itself.
    expect(screen.getByRole("link", { name: "Big Tech" })).toHaveAttribute(
      "href",
      "/categories?path=cat-1/cat-1a",
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "href",
      "/categories",
    );
    expect(within(crumbs).getByText("Growth")).toBeInTheDocument();
  });

  it("measures a nested level against its parent, not against the portfolio", () => {
    searchParams = new URLSearchParams("path=cat-1");
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const row = screen.getByRole("link", { name: "Big Tech" }).closest("tr") as HTMLElement;
    // Big Tech is all of Growth (100%) even though it is 26.51% of the book.
    expect(within(row).getByTestId("allocation")).toHaveTextContent("100.0% / 100%");
  });

  it("falls back to the deepest level it can reach when a path has gone stale", () => {
    searchParams = new URLSearchParams("path=cat-1/deleted-id");
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    // Deepest surviving ancestor is Growth, so its child is on screen…
    expect(screen.getByRole("link", { name: "Big Tech" })).toBeInTheDocument();
    // …and the URL is rewritten so the next drill-down does not rebuild the
    // broken path.
    expect(replace).toHaveBeenCalledWith("/categories?path=cat-1");
  });

  it("renders a root-level holding as its own row with its target", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const row = screen
      .getByRole("link", { name: "Bullion Trust Physical Gold" })
      .closest("tr") as HTMLElement;
    expect(within(row).getByTestId("allocation")).toHaveTextContent("4.7% / 5%");
  });

  it("shows unallocated holdings as one remainder row at the root only", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const table = screen.getByRole("table");
    const row = within(table).getByText("Unallocated").closest("tr") as HTMLElement;
    expect(within(row).getByTestId("allocation")).toHaveTextContent("1.1% / —");
    expect(screen.getByText("THEMEX")).toBeInTheDocument();

    cleanup();
    searchParams = new URLSearchParams("path=cat-1");
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    expect(within(screen.getByRole("table")).queryByText("Unallocated")).not.toBeInTheDocument();
  });

  it("renders an em dash for a row with no target set", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    const table = screen.getByRole("table");
    const row = within(table).getByText("Unallocated").closest("tr") as HTMLElement;
    expect(within(row).getByTestId("allocation")).toHaveTextContent("—");
  });

  it("sums only the targets of the level on screen", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    // Growth 40 + BULLION 5 = 45, and the unallocated remainder has no target.
    expect(screen.getByText("45.0% targeted")).toBeInTheDocument();
  });

  it("shows the FX-unavailable footnote only when fxIncomplete is set", () => {
    renderWithClient(<CategoriesClient />, seed(FIXTURE));
    expect(screen.queryByText(/Exchange rates are currently unavailable/)).not.toBeInTheDocument();
    cleanup();
    renderWithClient(<CategoriesClient />, seed({ ...FIXTURE, fxIncomplete: true }));
    expect(screen.getByText(/Exchange rates are currently unavailable/)).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing to show", () => {
    renderWithClient(<CategoriesClient />, seed(EMPTY));
    expect(screen.getByText(/No holdings to show yet/)).toBeInTheDocument();
  });
});
