import { Decimal } from "../money/decimal";

/** Payment cadence unit for a custom holding's income schedule. */
export type IncomeFrequencyUnit = "week" | "month" | "quarter" | "year";

const UNIT_MONTHS: Record<Exclude<IncomeFrequencyUnit, "week">, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** nth payment date, always derived from the FIRST date (no clamp drift).
 *  Month-based units clamp the day-of-month (Jan 31 + 1mo = Feb 28). */
function paymentDateAt(
  first: string,
  unit: IncomeFrequencyUnit,
  interval: number,
  n: number,
): string {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  if (unit === "week") {
    return toDateKey(Date.UTC(y, m - 1, d + n * interval * 7));
  }
  const months = n * interval * UNIT_MONTHS[unit];
  const targetMonth = new Date(Date.UTC(y, m - 1 + months, 1));
  const daysInMonth = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return toDateKey(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(d, daysInMonth)),
  );
}

/** All scheduled payment dates from the first payment through `until`
 *  (inclusive), additionally capped at `lastPaymentDate` when set. */
export function incomePaymentDates(opts: {
  firstPaymentDate: string;
  lastPaymentDate: string | null;
  unit: IncomeFrequencyUnit;
  interval: number;
  until: string;
}): string[] {
  if (!Number.isInteger(opts.interval) || opts.interval < 1) {
    throw new Error(
      `incomePaymentDates: interval must be a positive integer, got ${opts.interval}`,
    );
  }
  const dates: string[] = [];
  for (let n = 0; ; n++) {
    const date = paymentDateAt(opts.firstPaymentDate, opts.unit, opts.interval, n);
    if (date > opts.until) break;
    if (opts.lastPaymentDate !== null && date > opts.lastPaymentDate) break;
    dates.push(date);
  }
  return dates;
}

/**
 * Daily-accrual gross income over [start, end): Σ valueOn(day) × yearlyPct/365.
 * `valueOn` is the holding's value (units × price) at end of that day; buys are
 * effective on their trade date and the payment date itself does not accrue —
 * the window convention verified øre-exact against Snowball's CASH_DKK
 * payment (spec: Background).
 */
export function accrueGrossIncome(opts: {
  start: string;
  end: string;
  yearlyPct: Decimal;
  valueOn: (date: string) => Decimal;
}): Decimal {
  let sum = new Decimal(0);
  let cursor = new Date(`${opts.start}T00:00:00Z`).getTime();
  const endMs = new Date(`${opts.end}T00:00:00Z`).getTime();
  const DAY = 86_400_000;
  for (; cursor < endMs; cursor += DAY) {
    sum = sum.plus(opts.valueOn(toDateKey(cursor)));
  }
  return sum.times(opts.yearlyPct).dividedBy(36500);
}
