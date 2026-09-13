import { Card, CardTitle } from "@sage/ui";
import { formatMoney } from "../../lib/format";
import { formatGapPp } from "../performance-metrics";
import type { DashboardDTO } from "../../lib/types";

function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

export function PerformanceCard({
  ytdPercent,
  totalReturn,
  incomplete = false,
  relative,
  benchmarkYtdTwr,
}: {
  ytdPercent: number | null;
  totalReturn: DashboardDTO["totalReturn"];
  /** The figure was computed over price history that starts after a holding
   *  was first held. A mark, not a banner — the overview is not where this
   *  gets resolved, so it points at /performance rather than explaining. */
  incomplete?: boolean;
  /** Carries the benchmark's name, not a return figure — see
   *  `benchmarkYtdTwr` below for that. Only its `benchmarkName` is used here. */
  relative: DashboardDTO["relative"];
  /** The primary benchmark's own YTD TWR, published alongside `relative`
   *  because `PerformanceRelativeDTO` deliberately carries risk ratios, not
   *  returns. */
  benchmarkYtdTwr: DashboardDTO["benchmarkYtdTwr"];
}) {
  const tone = ytdPercent == null ? "" : ytdPercent >= 0 ? "text-gain" : "text-loss";
  // A signed pp gap against the primary benchmark, same treatment /performance
  // uses for "Against the benchmarks". Absent either half of the comparison —
  // no benchmark reached back far enough, or the portfolio has no YTD figure
  // of its own yet — the card says nothing rather than showing a dash or a
  // half-built sentence.
  const gapPp =
    relative && benchmarkYtdTwr != null && ytdPercent != null
      ? ytdPercent - benchmarkYtdTwr * 100
      : null;
  return (
    <Card>
      <CardTitle meta="YTD, time-weighted">Performance</CardTitle>
      <div className={`stat-num ${tone}`}>
        {pct(ytdPercent)}
        {incomplete && (
          <span
            aria-label="Figure is incomplete: some price history is missing"
            title="Some price history is missing — see Performance"
            className="ml-1 align-super text-xs text-muted-foreground"
          >
            *
          </span>
        )}
      </div>
      {gapPp != null && relative && (
        <div className="mt-1 text-xs text-muted-foreground">
          {formatGapPp(gapPp)} vs {relative.benchmarkName}
        </div>
      )}
      <div className="mt-1 text-xs text-muted-foreground">
        {totalReturn
          ? // The book's whole life in money: what today's holdings have gained,
            // every sale ever made, and the income banked after tax. Neither the
            // period nor the method of the YTD rate above, and deliberately no
            // percentage of its own — a lifetime gain has no denominator anyone
            // agrees on, so the rate stays a time-weighted one over a window.
            `Made since you started ${totalReturn.amount.amount.startsWith("-") ? "−" : "+"}${formatMoney(totalReturn.amount).replace(/^-/, "")}`
          : "Made since you started —"}
      </div>
    </Card>
  );
}
