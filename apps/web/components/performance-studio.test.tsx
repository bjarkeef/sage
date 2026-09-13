import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient, makeTestQueryClient } from "../lib/test/render-with-client";
import { qk } from "../lib/query/keys";
import type { PerformanceDTO } from "../lib/types";

vi.mock("lightweight-charts", () => {
  const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
  const ColorType = { Solid: "solid", VerticalGradient: "gradient" };
  const chartStub = {
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chartStub),
    AreaSeries: "Area",
    LineSeries: "Line",
    LineStyle,
    ColorType,
  };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("../lib/api", () => ({
  getPerformance: vi.fn(),
}));

// Import after the mocks above so PerformanceStudio's transitive deps pick them up.
import { PerformanceStudio } from "./performance-studio";
import * as api from "../lib/api";

const FIXTURE_1Y: PerformanceDTO = {
  displayCurrency: "USD",
  range: "1Y",
  window: { from: "2025-07-13", to: "2026-07-13", days: 365 },
  insufficientData: false,
  stalePrices: [],
  gain: { amount: "1200.00", currency: "USD" },
  simpleReturn: 0.05,
  twr: 0.12,
  twrAnnualized: 0.12,
  lifetime: {
    unrealised: { amount: "1200", currency: "DKK" },
    realised: { amount: "800", currency: "DKK" },
    income: { amount: "400", currency: "DKK" },
    total: { amount: "2400", currency: "DKK" },
  },
  volatility: 0.08,
  maxDrawdown: -0.04,
  bestDay: null,
  worstDay: null,
  indexSeries: [
    { date: "2025-07-13", value: 1.0 },
    { date: "2026-07-13", value: 1.12 },
  ],
  benchmarks: [],
  relative: null,
  basisMismatches: [],
  unverifiedSplits: [],
  historyIncomplete: [],
  multiCurrency: false,
  anomalousDays: 0,
  fxApproximated: false,
};

const FIXTURE_3M: PerformanceDTO = {
  ...FIXTURE_1Y,
  range: "3M",
  twr: 0.03,
  twrAnnualized: null,
};

beforeEach(() => vi.clearAllMocks());

describe("PerformanceStudio", () => {
  it("renders seeded 1Y cache data without calling getPerformance", async () => {
    const perfSpy = vi.spyOn(api, "getPerformance");

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), FIXTURE_1Y);

    renderWithClient(<PerformanceStudio />, qc);

    await waitFor(() => expect(screen.getByText("+12.0%")).toBeInTheDocument());
    expect(perfSpy).not.toHaveBeenCalled();
  });

  it("draws the benchmark legend with a dash, matching the line it stands for", async () => {
    // The benchmark series are LineStyle.Dashed (comparisonSeriesOptions) while
    // the portfolio is a solid area, but every legend swatch here was the same
    // round dot — so the legend encoded neither. portfolio-chart.tsx already
    // carries the dash into its swatches; this is the same chart grammar in the
    // sibling component.
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), {
      ...FIXTURE_1Y,
      benchmarks: [
        { id: "sp500", name: "S&P 500", twr: 0.1, points: [{ date: "2025-07-13", value: 1 }] },
      ],
    });

    renderWithClient(<PerformanceStudio />, qc);

    const benchmark = await screen.findByTestId("legend-swatch-sp500");
    expect(benchmark.style.background).toContain("repeating-linear-gradient");

    // "You" is a solid area series, so its swatch must NOT be dashed — a legend
    // where everything looks alike is the defect, not the fix.
    const you = screen.getByTestId("legend-swatch-you");
    expect(you.style.background).not.toContain("repeating-linear-gradient");
  });

  it("fetches the new range key when the segmented control changes", async () => {
    vi.mocked(api.getPerformance).mockResolvedValue(FIXTURE_3M);

    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), FIXTURE_1Y);

    renderWithClient(<PerformanceStudio />, qc);
    await waitFor(() => expect(screen.getByText("+12.0%")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "3M" }));

    await waitFor(() => expect(api.getPerformance).toHaveBeenCalledWith("3M"));
    await waitFor(() => expect(screen.getByText("+3.0%")).toBeInTheDocument());
  });

  it("labels the IRR/TWR when a flow had no historical rate and fell back to spot", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), { ...FIXTURE_1Y, fxApproximated: true });

    renderWithClient(<PerformanceStudio />, qc);

    await waitFor(() => expect(screen.getByText(/today's rate was used/i)).toBeInTheDocument());
  });

  it("warns when the rates behind the metrics have not refreshed in weeks", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), {
      ...FIXTURE_1Y,
      fxStale: true,
      fxRatesAsOf: "2026-07-01",
    });

    renderWithClient(<PerformanceStudio />, qc);

    await waitFor(() =>
      expect(screen.getByText(/have not refreshed since 2026-07-01/i)).toBeInTheDocument(),
    );
  });

  it("warns when a flow's currency could not be priced at all", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), { ...FIXTURE_1Y, fxIncomplete: true });

    renderWithClient(<PerformanceStudio />, qc);

    await waitFor(() =>
      expect(screen.getByText(/left out of these return figures/i)).toBeInTheDocument(),
    );
  });

  it("shows no FX banner when rates are fresh and complete", async () => {
    const qc = makeTestQueryClient();
    qc.setQueryData(qk.performance("1Y"), FIXTURE_1Y);

    renderWithClient(<PerformanceStudio />, qc);

    await waitFor(() => expect(screen.getByText("+12.0%")).toBeInTheDocument());
    expect(screen.queryByText(/exchange rate/i)).not.toBeInTheDocument();
  });
});
