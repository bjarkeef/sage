import type { AnnouncedDividendDTO, DividendIncomeDTO, IncomeGroupRow, MoneyDTO } from "./types";

/**
 * Net-of-tax multiplier for a flat dividend tax rate (percent). A null/undefined
 * rate means no tax configured → 1 (gross, unchanged). e.g. 35 → 0.65.
 */
export function netFactor(taxRate: number | null | undefined): number {
  if (taxRate == null) return 1;
  return 1 - taxRate / 100;
}

function scaleMoney(m: MoneyDTO, f: number): MoneyDTO {
  return { amount: (Number(m.amount) * f).toFixed(2), currency: m.currency };
}

function scaleStr(amount: string, f: number): string {
  return (Number(amount) * f).toFixed(2);
}

function scaleGroupRows(rows: IncomeGroupRow[], f: number): IncomeGroupRow[] {
  return rows.map((r) => ({ ...r, amount: scaleMoney(r.amount, f) }));
}

/**
 * Return a copy of the dividend-income view with every RECEIVED / PROJECTED
 * income figure scaled by `f` (the net-of-tax multiplier), so the whole
 * dividends page can render after-tax from a single transform.
 *
 * Scaled: retroactive/projected/announced `income`, the summary trailing /
 * forward / monthly / by-year totals, each `incomeByGroup` row's `amount` (so
 * the composition donut reconciles to the netted forward total — `share` is a
 * ratio and needs no scaling), and each holding's `forwardAnnualIncome`
 * — scaling the last one is what makes `computeGrossForwardYield` /
 * `yieldBySymbol` come out net automatically (they divide it by an untaxed
 * market value).
 *
 * Left GROSS on purpose: `amountPerShare` (the issuer's declared per-share
 * dividend, a factual figure people cross-check against announcements — not a
 * received amount) and `sharesHeld`/`shares`.
 *
 * `f === 1` (no tax configured) returns the input unchanged by reference.
 */
export function applyDividendTax(income: DividendIncomeDTO, f: number): DividendIncomeDTO {
  if (f === 1) return income;
  return {
    ...income,
    retroactive: income.retroactive.map((r) => ({ ...r, income: scaleStr(r.income, f) })),
    projected: income.projected.map((r) => ({ ...r, income: scaleStr(r.income, f) })),
    announced: income.announced.map((r) => ({ ...r, income: scaleStr(r.income, f) })),
    perHolding: income.perHolding.map((h) => ({
      ...h,
      forwardAnnualIncome: scaleMoney(h.forwardAnnualIncome, f),
    })),
    incomeByGroup: {
      holdings: scaleGroupRows(income.incomeByGroup.holdings, f),
      sector: scaleGroupRows(income.incomeByGroup.sector, f),
      currency: scaleGroupRows(income.incomeByGroup.currency, f),
    },
    summary: {
      ...income.summary,
      trailingTwelveMonthIncome: income.summary.trailingTwelveMonthIncome.map((m) =>
        scaleMoney(m, f),
      ),
      projectedTwelveMonthIncome: income.summary.projectedTwelveMonthIncome.map((m) =>
        scaleMoney(m, f),
      ),
      monthlyBreakdown: income.summary.monthlyBreakdown.map((m) => ({
        ...m,
        retroactive: scaleStr(m.retroactive, f),
        announced: scaleStr(m.announced, f),
        projected: scaleStr(m.projected, f),
      })),
      receivedByYear: income.summary.receivedByYear.map((y) => ({
        ...y,
        amount: scaleStr(y.amount, f),
      })),
    },
  };
}

/**
 * Net a list of announced dividends (`dashboard.upcomingDividends` /
 * `dashboard.recentDividends`) by scaling each row's `income` by `f`. The API
 * sends these gross straight off `income.announced`, so callers on the
 * Overview page apply this the same way `applyDividendTax` nets the
 * dividends-page DTO.
 *
 * Left GROSS on purpose, same reasoning as `applyDividendTax`: `amountPerShare`
 * (the issuer's declared per-share figure, cross-checked against
 * announcements) and `shares`.
 *
 * `f === 1` (no tax configured) returns the input unchanged by reference.
 */
export function netAnnouncedDividends(
  rows: AnnouncedDividendDTO[],
  f: number,
): AnnouncedDividendDTO[] {
  if (f === 1) return rows;
  return rows.map((r) => ({ ...r, income: scaleStr(r.income, f) }));
}
