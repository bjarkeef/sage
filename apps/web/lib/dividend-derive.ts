// Impure joins/grouping for the dividend bento cards, kept out of the
// (pure/presentational) card components per the bento plan. Mirrors the
// currency-safety gate established in ./portfolio-yields.ts.
import type { DividendPerHoldingDTO, PositionDTO, RetroactiveIncomeRowDTO } from "./types";

export interface YieldByHoldingRow {
  symbol: string;
  currentYield: number;
}

/**
 * Per-holding forward yield = forwardAnnualIncome ÷ marketValue, expressed
 * as a percentage. Gated on marketValue > 0 and same-currency (a holding's
 * own income ÷ its own market value is same-currency by construction —
 * this never sums across holdings, so it carries none of the repo's
 * documented FX-mixing yield risk). Holdings without a computable yield are
 * omitted rather than emitted as "—" rows. Sorted descending by yield.
 */
export function yieldByHolding(
  perHolding: DividendPerHoldingDTO[],
  positions: PositionDTO[],
): YieldByHoldingRow[] {
  const marketValueBySymbol = new Map(positions.map((p) => [p.symbol, p.marketValue]));
  const rows: YieldByHoldingRow[] = [];

  for (const h of perHolding) {
    const marketValue = marketValueBySymbol.get(h.symbol);
    if (!marketValue) continue;
    const marketValueAmount = Number(marketValue.amount);
    if (!(marketValueAmount > 0)) continue;
    if (marketValue.currency !== h.forwardAnnualIncome.currency) continue;

    const forward = Number(h.forwardAnnualIncome.amount);
    rows.push({ symbol: h.symbol, currentYield: (forward / marketValueAmount) * 100 });
  }

  return rows.sort((a, b) => b.currentYield - a.currentYield);
}

export interface MonthlyRhythmRow {
  month: string; // YYYY-MM
  amount: number;
}

/**
 * Buckets retroactive (actually-received) income by month of
 * `paymentDate ?? exDate`, restricted to the trailing 12-month window
 * ending at `now`'s month. Only months with at least one contributing row
 * are returned (ascending by month) — empty input yields an empty array
 * rather than a zero-filled 12-column skeleton.
 *
 * Precondition: `retroactive[].income` is already a single display currency
 * (the API converts every row to `displayCcy` in dividend-income-view before
 * the DTO is sent), so summing across rows in a month is FX-safe here. If that
 * ever stops holding, this sum would need a per-currency guard.
 */
export function monthlyRhythm(
  retroactive: RetroactiveIncomeRowDTO[],
  now: Date = new Date(),
): MonthlyRhythmRow[] {
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const windowStartKey = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, "0")}`;
  const windowEndKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const totals = new Map<string, number>();

  for (const r of retroactive) {
    const dateStr = r.paymentDate ?? r.exDate;
    const month = dateStr.slice(0, 7); // YYYY-MM
    if (month < windowStartKey || month > windowEndKey) continue;
    totals.set(month, (totals.get(month) ?? 0) + Number(r.income));
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));
}

/**
 * Symbol → forward yield % map, derived from {@link yieldByHolding} (so it
 * carries the same same-currency-per-holding safety). Symbols without a
 * computable yield are absent from the map rather than mapped to a sentinel.
 */
export function yieldBySymbol(
  perHolding: DividendPerHoldingDTO[],
  positions: PositionDTO[],
): Map<string, number> {
  return new Map(yieldByHolding(perHolding, positions).map((r) => [r.symbol, r.currentYield]));
}
