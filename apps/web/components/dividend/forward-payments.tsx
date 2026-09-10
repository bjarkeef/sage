"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BasisChip, Card, CardTitle } from "@sage/ui";
import type {
  AnnouncedDividendDTO,
  ProjectedIncomeRowDTO,
  RetroactiveIncomeRowDTO,
} from "../../lib/types";
import { sumIncome } from "../../lib/dividend-year";
import { formatMoney } from "../../lib/format";
import { ActArrow } from "./kpi-cards";
import { corners } from "./income-timeline";
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE } from "../charts/chart-theme";
import {
  CERTAINTY_FILL as FILL,
  CERTAINTY_STROKE,
  CertaintyBarsLegend,
  type Cert,
} from "../charts/certainty-bars";

/** Strongest certainty wins when a holding pays more than once in a month. */
const CERT_RANK: Record<Cert, number> = { paid: 0, confirmed: 1, estimated: 2 };

/** Short axis label; January carries the year so the boundary reads. A `~`
 *  prefix marks a month whose payment date Sage predicted rather than one a
 *  broker or announcement confirmed — the same uncertainty the estimated
 *  bar's outline already carries, surfaced on the axis too. */
export function monthTick(month: string, dateEstimated: boolean): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  const label =
    d.getUTCMonth() === 0
      ? `Jan '${String(d.getUTCFullYear()).slice(2)}`
      : d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return dateEstimated ? `~ ${label}` : label;
}

function monthFull(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The next 12 months starting at (and including) `currentMonth` — a genuinely
 *  forward window, no trailing months. */
function forwardWindowMonths(currentMonth: string): string[] {
  const [y, m] = currentMonth.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y ?? new Date().getFullYear(), (m ?? 1) - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

interface HoldingRow {
  symbol: string;
  income: number;
  cert: Cert;
  /** The currency this row's payments actually arrived in — NOT the card's
   *  display currency. In a mixed-currency month the tooltip withholds the
   *  total and the certainty sub-sums; labelling the per-holding rows with the
   *  shared currency anyway would read a DKK payment out as "$4.05", which is
   *  the one lie the withholding exists to prevent. */
  currency: string;
}

export interface MonthDatum {
  month: string;
  paid: number;
  confirmed: number;
  estimated: number;
  /** Raw sum across every payment in the month, regardless of currency — the
   *  bar's stack still needs a height even when the figure can't be labeled. */
  total: number;
  /** True when the month's payments do not share one currency. Every row
   *  here comes straight off `retroactive`/`announced`/`projected`, each
   *  carrying its own independent `currency` — unlike `dividend-income-bars`,
   *  which reads an already-server-aggregated `MonthlyBreakdownDTO` row where
   *  that conflict can't arise within a single row. */
  mixedCurrency: boolean;
  /** True when any payment contributing to the month has an estimated
   *  (Sage-predicted) payment date, as opposed to one a broker export or
   *  company announcement confirmed. Drives the `~` prefix on the x-axis
   *  tick — independent of `estimated` certainty, since a *confirmed*
   *  dividend can still carry a predicted, not-yet-announced pay date. */
  dateEstimated: boolean;
}

interface Payment {
  month: string;
  symbol: string;
  income: number;
  cert: Cert;
  currency: string;
  dateEstimated: boolean;
}

export interface ForwardChartData {
  months: string[];
  chartData: MonthDatum[];
  byMonth: Map<string, MonthDatum>;
  holdingsByMonth: Map<string, HoldingRow[]>;
  windowed: Payment[];
  /** Reference-line average across the 12-month window, or `null` when the
   *  window's payments do not share one currency — same honesty rule as a
   *  month's own total, since the line is a sum over all twelve months. */
  avg: number | null;
}

/** Fold every scheduled payment into its cash month, certainty and currency,
 *  then aggregate into the shapes the chart and its tooltip render from.
 *  Pulled out of the component so the currency-conflict handling — the same
 *  "a total that cannot be computed honestly is not shown" rule applied
 *  elsewhere on this page — can be unit tested without needing Recharts to
 *  actually lay out an SVG, which it never does against jsdom's zero-size
 *  container. */
export function buildForwardChartData(
  retroactive: RetroactiveIncomeRowDTO[],
  announced: AnnouncedDividendDTO[],
  projected: ProjectedIncomeRowDTO[],
  currentMonth: string,
): ForwardChartData {
  const months = forwardWindowMonths(currentMonth);
  const inWindow = new Set(months);
  // LOCAL time, never `toISOString()`: this key decides paid-vs-confirmed, and
  // a UTC day key reports the wrong day either side of midnight for anyone off
  // UTC — flipping a payment's certainty at the boundary. The calendar grid and
  // `dividend-year.ts` both carry the same warning and both use local time.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Retroactive rows whose payment date is still ahead (ex-passed, unpaid)
  // are "confirmed" upcoming cash — matching the forward-total treatment on
  // the API side.
  const payments: Payment[] = [];
  for (const r of retroactive) {
    const cashDate = r.paymentDate ?? r.exDate;
    payments.push({
      month: cashDate.slice(0, 7),
      symbol: r.symbol,
      income: Number(r.income),
      cert: cashDate <= todayIso ? "paid" : "confirmed",
      currency: r.currency,
      dateEstimated: r.paymentDateEstimated,
    });
  }
  for (const a of announced) {
    payments.push({
      month: (a.paymentDate ?? a.exDate).slice(0, 7),
      symbol: a.symbol,
      income: Number(a.income),
      cert: "confirmed",
      currency: a.currency,
      dateEstimated: a.paymentDateEstimated,
    });
  }
  for (const p of projected) {
    payments.push({
      month: (p.paymentDate ?? p.projectedExDate).slice(0, 7),
      symbol: p.symbol,
      income: Number(p.income),
      cert: "estimated",
      currency: p.currency,
      dateEstimated: p.paymentDateEstimated,
    });
  }
  const windowed = payments.filter((p) => inWindow.has(p.month) && p.income > 0);

  const byMonth = new Map<string, MonthDatum>(
    months.map((month) => [
      month,
      {
        month,
        paid: 0,
        confirmed: 0,
        estimated: 0,
        total: 0,
        mixedCurrency: false,
        dateEstimated: false,
      },
    ]),
  );
  const paymentsByMonth = new Map<string, Payment[]>();
  // Per-month, per-symbol aggregation for the tooltip (a holding may pay twice).
  const holdingAgg = new Map<string, Map<string, HoldingRow>>();
  for (const p of windowed) {
    const d = byMonth.get(p.month)!;
    d[p.cert] += p.income;
    d.total += p.income;
    if (p.dateEstimated) d.dateEstimated = true;

    const monthPayments = paymentsByMonth.get(p.month) ?? [];
    monthPayments.push(p);
    paymentsByMonth.set(p.month, monthPayments);

    let bySymbol = holdingAgg.get(p.month);
    if (!bySymbol) holdingAgg.set(p.month, (bySymbol = new Map<string, HoldingRow>()));
    // Keyed by symbol AND currency: a holding that paid in two currencies in
    // one month (an FX table that reached one payment and not the other) gets
    // one row per currency rather than one row adding them together, which is
    // the same "never add money across currencies" rule the totals follow.
    const key = `${p.symbol}|${p.currency}`;
    const existing = bySymbol.get(key);
    if (existing) {
      existing.income += p.income;
      if (CERT_RANK[p.cert] < CERT_RANK[existing.cert]) existing.cert = p.cert;
    } else {
      bySymbol.set(key, { symbol: p.symbol, income: p.income, cert: p.cert, currency: p.currency });
    }
  }
  // The raw per-cert/total sums above stand regardless — the stack still
  // needs a height — but a month whose payments don't share a currency gets
  // flagged so its TEXT figures render as "—" instead of a lying number.
  for (const [month, d] of byMonth) {
    const monthPayments = paymentsByMonth.get(month) ?? [];
    d.mixedCurrency =
      sumIncome(monthPayments.map((p) => ({ income: String(p.income), currency: p.currency }))) ===
      null;
  }

  const holdingsByMonth = new Map<string, HoldingRow[]>(
    [...holdingAgg.entries()].map(([month, rows]) => [
      month,
      [...rows.values()].sort((a, b) => b.income - a.income),
    ]),
  );

  const chartData = months.map((m) => byMonth.get(m)!);
  // The reference line is a sum over the WHOLE window, so it is built the
  // same way a month's own total is: from the raw payments, not from the
  // per-month totals (which may themselves already be unlabelable).
  const windowSum = sumIncome(
    windowed.map((p) => ({ income: String(p.income), currency: p.currency })),
  );
  const avg = windowSum ? windowSum.total / (chartData.length || 1) : null;

  return { months, chartData, byMonth, holdingsByMonth, windowed, avg };
}

/** Cap the per-holding tooltip so a month with a long tail of tiny payers
 *  doesn't overflow the popover. */
const MAX_TOOLTIP_ROWS = 8;

/** The above-bar figure for one month, or "—" when its payments don't share
 *  a currency. `null` when there is nothing to label at all (an empty
 *  month), matching the LabelList convention of rendering nothing. */
export function forwardBarLabel(datum: MonthDatum | undefined): string | null {
  if (!datum || !datum.total) return null;
  return datum.mixedCurrency ? "—" : Math.round(datum.total).toLocaleString();
}

/** Which months get a direct label: the peak, the trough, and the current
 *  month — deduplicated, because on a one-payment book a single month is all
 *  three. A number on every bar is an axis doing its job badly; three numbers
 *  are the ones a reader actually wants. */
export function labelledMonthIndices(data: MonthDatum[]): Set<number> {
  if (!data.some((d) => d.total > 0)) return new Set();

  // Index 0 is always the current month — the window is forward from today
  // (see `forwardWindowMonths`) — and is worth labelling even in a month with
  // nothing in it, for the same reason an empty bar still gets drawn.
  const indices = new Set<number>([0]);

  let peakIndex = -1;
  let peakTotal = -Infinity;
  let troughIndex = -1;
  let troughTotal = Infinity;
  data.forEach((d, i) => {
    if (d.total <= 0) return; // ignore empty months when picking peak/trough
    if (d.total > peakTotal) {
      peakTotal = d.total;
      peakIndex = i;
    }
    if (d.total < troughTotal) {
      troughTotal = d.total;
      troughIndex = i;
    }
  });
  if (peakIndex >= 0) indices.add(peakIndex);
  if (troughIndex >= 0) indices.add(troughIndex);
  return indices;
}

/** Which certainty segment is the visual cap of one month's stack — the
 *  topmost segment (estimated, then confirmed, then paid) that actually has
 *  a nonzero value. A $0 "estimated" entry draws no rectangle, so without
 *  this a month with only paid/confirmed income would leave a square-topped
 *  confirmed segment passing for the top of the stack. `null` for an empty
 *  month, where no segment draws at all. */
export function capSegment(datum: MonthDatum): Cert | null {
  if (datum.estimated > 0) return "estimated";
  if (datum.confirmed > 0) return "confirmed";
  if (datum.paid > 0) return "paid";
  return null;
}

export function ForwardTooltip({
  active,
  label,
  byMonth,
  holdingsByMonth,
  currency,
}: {
  active?: boolean;
  label?: string | number;
  byMonth: Map<string, MonthDatum>;
  holdingsByMonth: Map<string, HoldingRow[]>;
  currency: string;
}) {
  if (!active || label == null) return null;
  const month = String(label);
  const datum = byMonth.get(month);
  if (!datum || datum.total === 0) return null;
  const fmt = (n: number) => formatMoney({ amount: n.toFixed(2), currency });
  // Every per-holding row carries the currency it actually paid in; the card's
  // shared `currency` is only a fallback for a row that arrived without one.
  const fmtRow = (row: HoldingRow) =>
    formatMoney({ amount: row.income.toFixed(2), currency: row.currency || currency });
  // A conflicted month has nothing honest to label — not the total, and not
  // any of the per-certainty sub-sums, since each of those is itself a sum
  // over that same currency-mixed set of payments.
  const certRows = datum.mixedCurrency
    ? []
    : (
        [
          ["paid", "Paid", datum.paid],
          ["confirmed", "Confirmed", datum.confirmed],
          ["estimated", "Estimated", datum.estimated],
        ] as const
      ).filter(([, , v]) => v > 0);
  const holdings = holdingsByMonth.get(month) ?? [];
  const shown = holdings.slice(0, MAX_TOOLTIP_ROWS);
  const hidden = holdings.length - shown.length;

  return (
    <div className="min-w-[11rem] max-w-[16rem] rounded-control border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <span className="label-caps text-muted-foreground">{monthFull(month)}</span>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {datum.mixedCurrency ? "—" : fmt(datum.total)}
        </span>
      </div>
      {certRows.length > 0 && (
        <div className="flex flex-col gap-0.5 border-b border-border pb-1.5">
          {certRows.map(([key, name, value]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: FILL[key] }} />
              <span className="text-muted-foreground">{name}</span>
              <span className="ml-auto font-mono tabular-nums text-foreground">{fmt(value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex flex-col gap-0.5">
        {shown.map((h) => (
          <div key={`${h.symbol}|${h.currency}`} className="flex items-center gap-2 text-xs">
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: FILL[h.cert] }}
            />
            <span className="truncate font-mono text-xs text-foreground">{h.symbol}</span>
            <span className="ml-auto font-mono tabular-nums text-muted-foreground">
              {fmtRow(h)}
            </span>
          </div>
        ))}
        {hidden > 0 && <div className="pl-3.5 text-xs text-muted-foreground">+{hidden} more</div>}
      </div>
    </div>
  );
}

/** Bento card: the next 12 months of forward payments, stacked by certainty
 *  (paid / confirmed / estimated) with an average reference line, month totals,
 *  and a per-holding breakdown on hover. Its own Recharts chart — the
 *  /dividends Income view keeps the interactive month-select `DividendIncomeBars`. */
export function ForwardPayments({
  retroactive,
  announced,
  projected,
  currentMonth,
  currency,
  taxed = false,
}: {
  retroactive: RetroactiveIncomeRowDTO[];
  announced: AnnouncedDividendDTO[];
  projected: ProjectedIncomeRowDTO[];
  currentMonth: string;
  currency: string;
  /** Whether the month totals below are net of a configured dividend tax
   *  rate — drives the `BasisChip` in the title row. Optional so this
   *  component's own unit tests (which don't exercise tax) don't need to
   *  thread it; the real caller (`/dividends/analytics`) always passes it
   *  explicitly. */
  taxed?: boolean;
}) {
  const { chartData, byMonth, holdingsByMonth, windowed, avg } = buildForwardChartData(
    retroactive,
    announced,
    projected,
    currentMonth,
  );
  // The average used to be an in-plot ReferenceLine label, which an 8px right
  // margin clipped to a sliver. The figure survives; only where it's drawn
  // changed — the subtitle has no edge to clip against.
  const avgLabel =
    avg != null && avg > 0
      ? `${formatMoney({ amount: avg.toFixed(2), currency })} / mo average`
      : null;
  const labelledIndices = labelledMonthIndices(chartData);

  return (
    <Card
      compact
      className="group relative flex h-full flex-col transition-colors hover:bg-surface-hover/60"
    >
      <ActArrow />
      <div className="mb-3.5">
        <CardTitle className="mb-0" meta={<BasisChip taxed={taxed} />}>
          Next 12 months
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          Forward payments{avgLabel != null ? ` · ${avgLabel}` : ""}
        </div>
      </div>

      {windowed.length === 0 ? (
        <div className="text-xs text-muted-foreground">No forward payments yet</div>
      ) : (
        <>
          <div className="flex-1" style={{ minHeight: 176 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 18, right: 8, left: 20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  tickFormatter={(month: string) =>
                    monthTick(month, byMonth.get(month)?.dateEstimated ?? false)
                  }
                  interval={0}
                  dy={4}
                />
                <YAxis
                  domain={[0, "dataMax"]}
                  tickCount={3}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  width={36}
                  tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                />
                {avg != null && avg > 0 && (
                  <ReferenceLine
                    y={avg}
                    stroke={CERTAINTY_STROKE.estimated}
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                    label={{
                      value: "avg",
                      position: "insideTopLeft",
                      fill: CERTAINTY_STROKE.estimated,
                      fontSize: 10,
                    }}
                  />
                )}
                <Tooltip
                  cursor={{ fill: CURSOR_FILL }}
                  content={
                    <ForwardTooltip
                      byMonth={byMonth}
                      holdingsByMonth={holdingsByMonth}
                      currency={currency}
                    />
                  }
                />
                {/* Mark spec: a 4px radius on the free end — whichever segment
                    is visually on top of a given month's stack, since a $0
                    "estimated" entry draws no rectangle and can't be assumed
                    to be it (see `capSegment`).

                    The spec also calls for a 2px gap between stacked
                    segments. That is deliberately NOT implemented here: an
                    earlier version simulated it with a `var(--card)` stroke
                    on the whole `paid`/`confirmed` `<Bar>`, but an SVG
                    `<rect>` stroke is centered on all four edges, not just
                    top/bottom — it also punched a card-coloured inset along
                    the left/right silhouette of every segment, and outlined
                    the outer rounded corner too whenever `capSegment` picked
                    that segment as the free end (`<Cell>` only overrides
                    `radius`, not the parent `Bar`'s `stroke`). The result was
                    a rim around the bar, not a gap inside it. Fixing that
                    properly needs a custom Recharts `shape` that insets
                    `y`/`height` at internal seams only, never the outer
                    silhouette — deferred because it can't be visually
                    verified from this worktree. No gap is honest; a rim
                    artifact on every bar is not. */}
                <Bar dataKey="paid" name="Paid" stackId="a" fill={FILL.paid} maxBarSize={30}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.month}
                      {...corners(capSegment(d) === "paid" ? [4, 4, 0, 0] : [0, 0, 0, 0])}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="confirmed"
                  name="Confirmed"
                  stackId="a"
                  fill={FILL.confirmed}
                  maxBarSize={30}
                >
                  {chartData.map((d) => (
                    <Cell
                      key={d.month}
                      {...corners(capSegment(d) === "confirmed" ? [4, 4, 0, 0] : [0, 0, 0, 0])}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="estimated"
                  name="Estimated"
                  stackId="a"
                  fill={FILL.estimated}
                  stroke={CERTAINTY_STROKE.estimated}
                  strokeDasharray="3 3"
                  maxBarSize={30}
                >
                  {chartData.map((d) => (
                    <Cell
                      key={d.month}
                      {...corners(capSegment(d) === "estimated" ? [4, 4, 0, 0] : [0, 0, 0, 0])}
                    />
                  ))}
                  <LabelList
                    dataKey="total"
                    content={(props: {
                      x?: string | number;
                      y?: string | number;
                      width?: string | number;
                      index?: number;
                    }) => {
                      const { x, y, width, index } = props;
                      // Only the peak, the trough and the current month get a
                      // direct figure — a number on every bar is an axis
                      // doing its job badly, and the chart now has one.
                      if (index == null || !labelledIndices.has(index)) return null;
                      const datum = chartData[index];
                      const text = forwardBarLabel(datum);
                      if (text == null || typeof x !== "number" || typeof width !== "number") {
                        return null;
                      }
                      return (
                        <text
                          x={x + width / 2}
                          y={typeof y === "number" ? y - 6 : 0}
                          textAnchor="middle"
                          fill="var(--muted-foreground)"
                          fontSize={10}
                          className="tabular-nums"
                        >
                          {text}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <CertaintyBarsLegend />
        </>
      )}
    </Card>
  );
}
