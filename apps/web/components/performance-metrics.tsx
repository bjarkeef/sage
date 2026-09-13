import * as React from "react";
import { Card, InfoTooltip, RelativeScale, cn } from "@sage/ui";
import type { PerformanceDTO, PerformanceRelativeDTO, RelativeFigureDTO } from "../lib/types";
import { formatMoney } from "../lib/format";
import { formatRate } from "./performance-stats";

/** Short "Apr 9" style date, matching the chart tooltip's date formatting. */
function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** A percentage-point gap, signed. The minus is the typographic one used
 *  everywhere else in the app, not a hyphen. Exported so the overview's
 *  Performance card can print the same gap figure /performance does, rather
 *  than keeping a second copy that could drift. */
export function formatGapPp(pp: number): string {
  return `${pp >= 0 ? "+" : "−"}${Math.abs(pp).toFixed(1)}pp`;
}

/** Whole-percent distance from parity, e.g. 0.8667 → 13. */
function distanceFromParity(ratio: number): number {
  return Math.round(Math.abs(ratio - 1) * 100);
}

function volatilitySentence(ratio: number, benchmarkName: string): string {
  const pct = distanceFromParity(ratio);
  if (pct === 0) return `Day-to-day movement in line with the ${benchmarkName}.`;
  const direction = ratio < 1 ? "less" : "more";
  return `${pct}% ${direction} day-to-day movement than the ${benchmarkName}.`;
}

function drawdownSentence(ratio: number, benchmarkName: string): string {
  const pct = distanceFromParity(ratio);
  if (pct === 0) return `As deep as the ${benchmarkName}'s own worst fall.`;
  const direction = ratio < 1 ? "shallower" : "deeper";
  return `${pct}% ${direction} than the ${benchmarkName}'s own worst fall.`;
}

/** Beta said as the thing it actually measures. A bare "0.62" tells a reader
 *  nothing; the movement ratio is the whole meaning of the number. */
function betaSentence(beta: number, benchmarkName: string): string {
  const magnitude = Math.abs(beta).toFixed(2);
  const tail = beta < 0 ? "% the other way." : "%.";
  return `For every 1% the ${benchmarkName} moved, your portfolio moved ${magnitude}${tail}`;
}

/** One bento tile: the figure leads, with the title and an info tooltip above
 *  it carrying the definition. Nothing is dropped — the explanation is a tap
 *  away rather than a paragraph of grey prose sitting between the title and
 *  the number it describes. */
function MetricCard({
  title,
  definition,
  figure,
  sub,
  footer,
  className,
}: {
  title: string;
  definition: string;
  figure: React.ReactNode;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card compact className={cn("flex flex-col", className)}>
      <h3 className="flex items-center gap-1 text-sm font-medium">
        {title}
        {/* Named per card rather than a flat "About this figure": five of these
            sit in one view, and five identically-named buttons are worse to
            navigate by name than a slightly stiff one. The colon keeps titles
            that are not noun phrases ("Against the benchmarks") readable. */}
        <InfoTooltip label={`About: ${title}`}>{definition}</InfoTooltip>
      </h3>
      <div className="mt-3 stat-num">{figure}</div>
      {sub != null && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {footer != null && <div className="mt-auto pt-4">{footer}</div>}
    </Card>
  );
}

/** A benchmark-relative figure with its scale and a sentence, or an honest note
 *  about why the comparison is absent. */
function ScaleFooter({
  figure,
  benchmarkName,
  sentence,
  noun,
}: {
  figure: RelativeFigureDTO | null;
  benchmarkName: string | null;
  sentence: (ratio: number, name: string) => string;
  noun: string;
}) {
  if (!figure || !benchmarkName) {
    return <p className="text-xs text-muted-foreground">No benchmark data for this window.</p>;
  }
  const text = sentence(figure.ratio, benchmarkName);
  return (
    <div>
      <p className="text-xs text-muted-foreground">{text}</p>
      <RelativeScale ratio={figure.ratio} pinLabel={benchmarkName} srLabel={`${noun}: ${text}`} />
    </div>
  );
}

function BetaFooter({ rel }: { rel: PerformanceRelativeDTO | null }) {
  if (!rel) {
    return <p className="text-xs text-muted-foreground">No benchmark data for this window.</p>;
  }
  if (rel.beta === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {`Needs ${rel.minPairedDaysForBeta} overlapping market days to measure; this window has ${rel.pairedDays}.`}
      </p>
    );
  }
  const text = betaSentence(rel.beta, rel.benchmarkName);
  return (
    <div>
      <p className="text-xs text-muted-foreground">{text}</p>
      <RelativeScale ratio={rel.beta} pinLabel={rel.benchmarkName} srLabel={`Beta: ${text}`} />
    </div>
  );
}

/** The metrics bento beneath the performance chart. Every figure the page
 *  reports gets a tile that names it, defines it, and — where a benchmark makes
 *  the comparison meaningful — places it against the market. Replaces the old
 *  stat strip, which had room for a number and a label and nothing else. */
export function PerfMetrics({ data }: { data: PerformanceDTO }) {
  const rel = data.relative;
  const benchmarkName = rel?.benchmarkName ?? null;
  // Match the benchmark the scales are pinned to, not whichever arrived first.
  // `benchmarks` comes back in fetch-completion order, so reading [0] made this
  // card announce "versus MSCI World" while every scale below said "S&P 500".
  const primary =
    data.benchmarks.find((b) => b.id === rel?.benchmarkId) ?? data.benchmarks[0] ?? null;
  const primaryGapPp = primary && data.twr != null ? (data.twr - primary.twr) * 100 : null;
  // Same order for the rows, so the headline's benchmark reads first.
  const orderedBenchmarks = primary
    ? [primary, ...data.benchmarks.filter((b) => b.id !== primary.id)]
    : data.benchmarks;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MetricCard
        className="md:col-span-2"
        title="Against the benchmarks"
        definition="Time-weighted return strips out when you added or sold, so it compares like for like with an index — which is why it can differ sharply from what your money actually earned. The benchmarks are total-return series: they reinvest the index's own dividends, because your figure counts yours. That makes them read higher than the price index quoted in the news. Gaps are in percentage points."
        figure={primaryGapPp != null ? formatGapPp(primaryGapPp) : "—"}
        sub={
          data.benchmarks.length > 0
            ? `versus ${primary!.name}`
            : "No benchmark data for this window."
        }
        footer={
          data.benchmarks.length > 0 ? (
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              {orderedBenchmarks.map((bm) => {
                const deltaPp = data.twr != null ? (data.twr - bm.twr) * 100 : null;
                return (
                  <div key={bm.id} className="text-xs">
                    <span className="text-muted-foreground">{bm.name} </span>
                    <span className="tabular-nums">{formatRate(bm.twr)}</span>
                    {deltaPp != null && (
                      <span className="ml-1.5 tabular-nums text-muted-foreground">
                        {formatGapPp(deltaPp)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : undefined
        }
      />

      <MetricCard
        title="Money-weighted return"
        definition="What your money actually earned, timing included. It differs from time-weighted whenever you added or sold during the period."
        figure={data.mwrAnnualized != null ? formatRate(data.mwrAnnualized) : formatRate(data.mwr)}
        sub={data.mwrAnnualized != null ? "annualized" : undefined}
      />

      <MetricCard
        title="Return on money in"
        definition="The same gain, over what you had paid in when the window opened. This is the figure the overview shows, and it will not match the time-weighted return above: that one removes your deposits so it can be compared with an index, this one does not. Neither is wrong — they answer different questions about the same kroner."
        figure={data.simpleReturn != null ? formatRate(data.simpleReturn) : "—"}
        sub={data.gain ? `${formatMoney(data.gain)} earned` : undefined}
      />

      <MetricCard
        title="Volatility"
        definition="How much the portfolio moved day to day, annualised. Higher means a bumpier ride, not necessarily a worse one."
        figure={formatRate(data.volatility, { sign: false })}
        footer={
          <ScaleFooter
            figure={rel?.volatility ?? null}
            benchmarkName={benchmarkName}
            sentence={volatilitySentence}
            noun="Volatility"
          />
        }
      />

      <MetricCard
        title="Beta"
        definition="How hard the portfolio moves when the market moves. 1.00 tracks the market exactly."
        figure={rel?.beta != null ? rel.beta.toFixed(2) : "—"}
        footer={<BetaFooter rel={rel} />}
      />

      <MetricCard
        title="Max drawdown"
        definition="The deepest fall from a peak to a trough inside the period."
        figure={
          data.maxDrawdown != null ? `−${formatRate(data.maxDrawdown, { sign: false })}` : "—"
        }
        footer={
          <ScaleFooter
            figure={rel?.maxDrawdown ?? null}
            benchmarkName={benchmarkName}
            sentence={drawdownSentence}
            noun="Max drawdown"
          />
        }
      />

      <MetricCard
        className="md:col-span-3"
        title="Best and worst day"
        definition="The strongest and weakest single days in the period."
        figure={
          <div className="flex flex-wrap items-baseline gap-x-10 gap-y-2">
            <span>
              {data.bestDay ? formatRate(data.bestDay.value) : "—"}
              {data.bestDay && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatShortDate(data.bestDay.date)}
                </span>
              )}
            </span>
            <span>
              {data.worstDay ? formatRate(data.worstDay.value) : "—"}
              {data.worstDay && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatShortDate(data.worstDay.date)}
                </span>
              )}
            </span>
          </div>
        }
      />
    </div>
  );
}
