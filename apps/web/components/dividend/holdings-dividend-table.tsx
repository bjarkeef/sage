"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardTitle } from "@sage/ui";
import type { DividendPerHoldingDTO, DividendTrend, PositionDTO } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import { CompanyLogo } from "../company-logo";
// Shared income ramp (the `--seg-*` tokens) so a holding keeps one color
// across the composition donut and this table's "share of income" bar. From
// `chart-theme`, NOT from the donut's own module: this table is imported
// statically by /dividends/analytics, so reaching into a recharts-importing
// module for a constant pulls recharts into that route's initial bundle.
import { segColor } from "../charts/chart-theme";

const TREND_GLYPH: Record<DividendTrend, string> = {
  climbing: "↑",
  flat: "→",
  cutting: "↓",
  unknown: "→",
};

interface HoldingsRow {
  symbol: string;
  name: string;
  website: string | null;
  annual: number;
  annualCurrency: string;
  incomeShare: number;
  yieldPct: number | null;
  yieldOnCostPct: number | null;
  cagrPct: number | null;
  trend: DividendTrend;
}

/** Per-row forward yield = forwardAnnualIncome ÷ marketValue, gated on
 *  marketValue > 0 and same-currency — the SAME gate `yieldByHolding` in
 *  `lib/dividend-derive.ts` uses. A holding's own income ÷ its own market
 *  value is same-currency by construction, so this never sums across
 *  holdings and carries none of the repo's documented FX-mixing yield risk. */
function forwardYieldPct(h: DividendPerHoldingDTO, pos: PositionDTO): number | null {
  const marketValue = pos.marketValue;
  if (!marketValue) return null;
  const marketValueAmount = Number(marketValue.amount);
  if (!(marketValueAmount > 0)) return null;
  if (marketValue.currency !== h.forwardAnnualIncome.currency) return null;
  return (Number(h.forwardAnnualIncome.amount) / marketValueAmount) * 100;
}

/** Join `perHolding` (forward income, income share, CAGR, trend) to
 *  `positions` (name/logo/yield-on-cost/market value) by symbol. Holdings
 *  without a matching position are omitted — there is no row to render.
 *
 *  `factor` is the net-of-tax multiplier (see `netFactor`/`useNetDividendIncome`).
 *  `perHolding`'s own figures (annual income, share, forward yield) arrive
 *  already netted via `applyDividendTax` — but `pos.yieldOnCost` comes straight
 *  from the (untaxed) portfolio positions, so it's scaled here explicitly.
 *  Defaults to 1 (unchanged) for callers that don't pass a rate. */
function buildRows(
  perHolding: DividendPerHoldingDTO[],
  positions: PositionDTO[],
  factor: number,
): HoldingsRow[] {
  const positionBySymbol = new Map(positions.map((p) => [p.symbol, p]));
  const rows: HoldingsRow[] = [];
  for (const h of perHolding) {
    const pos = positionBySymbol.get(h.symbol);
    if (!pos) continue;
    rows.push({
      symbol: h.symbol,
      name: pos.name,
      website: pos.website,
      annual: Number(h.forwardAnnualIncome.amount),
      annualCurrency: h.forwardAnnualIncome.currency,
      incomeShare: h.incomeShare,
      yieldPct: forwardYieldPct(h, pos),
      yieldOnCostPct: pos.yieldOnCost != null ? pos.yieldOnCost * 100 * factor : null,
      cagrPct: h.cagr5y != null ? Number(h.cagr5y) * 100 : null,
      trend: h.trend,
    });
  }
  return rows;
}

/** Maps each holding's symbol to a `--seg-*` color keyed by its INCOME RANK
 *  (index when sorted by forward annual income desc) — rank 0 → seg-1 … rank
 *  6 → seg-7, rank ≥7 → seg-rest. Computed once from income-desc order so a
 *  holding's "share of income" bar keeps the same color as its slice in the
 *  Income composition donut (Task 3), regardless of the table's active sort. */
function buildIncomeRankColors(rows: HoldingsRow[]): Map<string, string> {
  const byIncomeDesc = [...rows].sort((a, b) => b.annual - a.annual);
  const colors = new Map<string, string>();
  byIncomeDesc.forEach((r, i) => colors.set(r.symbol, segColor(i)));
  return colors;
}

type SortKey = "symbol" | "annual" | "share" | "yield" | "yieldOnCost" | "growth";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const DEFAULT_SORT: SortState = { key: "annual", dir: "desc" };

const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = {
  symbol: "asc",
  annual: "desc",
  share: "desc",
  yield: "desc",
  yieldOnCost: "desc",
  growth: "desc",
};

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "symbol", label: "Holding", align: "left" },
  { key: "annual", label: "Annual", align: "right" },
  { key: "share", label: "Share of income", align: "right" },
  { key: "yield", label: "Yield", align: "right" },
  { key: "yieldOnCost", label: "Yield on cost", align: "right" },
  { key: "growth", label: "Growth", align: "right" },
];

function sortValue(r: HoldingsRow, key: SortKey): number | string | null {
  switch (key) {
    case "symbol":
      return r.symbol;
    case "annual":
      return r.annual;
    case "share":
      return r.incomeShare;
    case "yield":
      return r.yieldPct;
    case "yieldOnCost":
      return r.yieldOnCostPct;
    case "growth":
      return r.cagrPct;
  }
}

/** Nulls always sort last, regardless of direction. */
function sortRows(rows: HoldingsRow[], sort: SortState): HoldingsRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

const GRID = "grid grid-cols-[minmax(140px,1.6fr)_90px_170px_70px_100px_90px] items-center gap-3";

export function HoldingsDividendTable({
  perHolding,
  positions,
  factor = 1,
}: {
  perHolding: DividendPerHoldingDTO[];
  positions: PositionDTO[];
  /** Net-of-tax multiplier applied to `yieldOnCost` (see module doc on `buildRows`). */
  factor?: number;
}) {
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);

  const rows = React.useMemo(
    () => buildRows(perHolding, positions, factor),
    [perHolding, positions, factor],
  );
  const incomeRankColors = React.useMemo(() => buildIncomeRankColors(rows), [rows]);
  const sorted = React.useMemo(() => sortRows(rows, sort), [rows, sort]);
  // Bars are max-normalized (widest = the top holding's share) so the "share
  // of income" column reads as an at-a-glance comparison, matching the mockup —
  // a literal share-as-width would leave every bar near-empty on a diversified
  // book. The numeric % beside each bar still shows the true share.
  const maxShare = React.useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.incomeShare), 0),
    [rows],
  );

  function handleHeaderClick(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DEFAULT_DIR[key] },
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card compact className="flex flex-col">
      <div className="mb-3.5">
        <CardTitle className="mb-0">Holdings</CardTitle>
        <div className="text-xs text-muted-foreground">
          Sorted by annual income. Click a row to open the asset.
        </div>
      </div>

      <div className={`${GRID} border-b border-border pb-2`}>
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => handleHeaderClick(col.key)}
            className={`label-caps text-muted-foreground transition-colors hover:text-foreground ${
              col.align === "left" ? "text-left" : "text-right"
            }`}
          >
            {col.label}
            {sort.key === col.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-col">
        {sorted.map((r) => {
          const positive = r.cagrPct != null && r.cagrPct >= 0;
          return (
            <Link
              key={r.symbol}
              href={`/asset/${r.symbol}`}
              data-testid="holding-row"
              className={`${GRID} border-b border-border py-3 text-sm transition-colors last:border-b-0 hover:bg-surface-hover`}
            >
              <div className="flex min-w-0 items-center gap-2 text-left">
                <CompanyLogo website={r.website} symbol={r.symbol} size={22} />
                <span className="font-mono font-medium tabular-nums">{r.symbol}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{r.name}</span>
              </div>

              <div className="text-right font-mono tabular-nums">
                {formatMoney({ amount: r.annual.toFixed(2), currency: r.annualCurrency })}
              </div>

              <div className="flex items-center justify-end gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-badge bg-surface-hover">
                  <div
                    className="h-full rounded-badge"
                    style={{
                      width: `${maxShare > 0 ? (r.incomeShare / maxShare) * 100 : 0}%`,
                      background: incomeRankColors.get(r.symbol),
                    }}
                  />
                </div>
                <span
                  data-testid="share-of-income"
                  className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {(r.incomeShare * 100).toFixed(1)}%
                </span>
              </div>

              <div data-testid="yield" className="text-right font-mono tabular-nums">
                {r.yieldPct != null ? `${r.yieldPct.toFixed(1)}%` : "—"}
              </div>

              <div data-testid="yield-on-cost" className="text-right font-mono tabular-nums">
                {r.yieldOnCostPct != null ? `${r.yieldOnCostPct.toFixed(1)}%` : "—"}
              </div>

              <div
                data-testid="growth"
                className={`text-right font-mono tabular-nums ${
                  r.cagrPct == null ? "text-muted-foreground" : positive ? "text-gain" : "text-loss"
                }`}
              >
                {r.cagrPct == null
                  ? "—"
                  : `${TREND_GLYPH[r.trend]} ${positive ? "+" : "−"}${Math.abs(r.cagrPct).toFixed(0)}%`}
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
