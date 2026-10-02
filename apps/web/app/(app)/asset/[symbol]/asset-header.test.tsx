import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetHeader } from "./asset-header";
import { assetDetail } from "../../../../lib/test/asset-fixtures";
import type { ChartReadout } from "../../../../lib/asset-chart/readout";

const d = assetDetail();
const resting: ChartReadout = {
  close: null,
  date: null,
  currency: "USD",
  rangePhrase: "past year",
  price: { abs: -3.35, pct: -9.8 },
  totalReturnPct: null,
  compare: null,
};

function renderHeader(readout: ChartReadout | null) {
  return render(
    <AssetHeader profile={d.profile} quote={d.quote} held custom={null} readout={readout} />,
  );
}

describe("AssetHeader readout", () => {
  it("shows the quote, the range's change in Delta grammar, the range named, and the quote's date", () => {
    renderHeader(resting);
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    const line = screen.getByTestId("chart-readout").textContent;
    expect(line).toMatch(/[-−]\$3\.35/);
    expect(line).toMatch(/\([-−]9\.80%\)/);
    expect(line).toContain("past year");
    expect(screen.getByText(/^As of Jun 15, 2026$/)).toBeInTheDocument();
  });

  it("becomes the hovered close and the change to that day while scrubbing", () => {
    renderHeader({ ...resting, close: 58.12, date: "2026-05-04", price: { abs: -1.5, pct: -2.5 } });
    expect(screen.getByText("$58.12")).toBeInTheDocument();
    expect(screen.queryByText("$60.00")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-readout").textContent).toContain("to May 4, 2026");
    expect(screen.queryByText(/^As of/)).not.toBeInTheDocument();
  });

  it("reads total return beside price in TR mode", () => {
    renderHeader({ ...resting, totalReturnPct: 2.1 });
    const line = screen.getByTestId("chart-readout").textContent;
    expect(line).toContain("+2.1% with dividends");
    expect(line).toContain("−9.8% price");
  });

  it("reads you against the benchmark when comparing", () => {
    renderHeader({
      ...resting,
      compare: {
        name: "S&P 500 (TR)",
        status: "ready",
        reason: null,
        youPct: 2.1,
        benchmarkPct: 14.3,
      },
    });
    expect(screen.getByTestId("chart-readout").textContent).toContain(
      "You +2.1% · S&P 500 (TR) +14.3%",
    );
  });

  it("says when the benchmark is unavailable, and keeps the holding's own line", () => {
    renderHeader({
      ...resting,
      compare: {
        name: "S&P 500 (TR)",
        status: "unavailable",
        reason: "S&P 500 (TR) unavailable",
        youPct: null,
        benchmarkPct: null,
      },
    });
    const line = screen.getByTestId("chart-readout").textContent;
    expect(line).toContain("S&P 500 (TR) unavailable");
    expect(line).toContain("past year");
  });
});
