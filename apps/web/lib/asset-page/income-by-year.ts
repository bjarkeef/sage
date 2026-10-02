import { cashDate } from "./figures";
import { perShareJumpFlag, type Flag } from "./reliability";
import type { AssetDividendsDTO, AssetUpcomingDTO } from "../types";

export const MAX_PAST_YEARS = 10;

export interface YearBar {
  year: number;
  kind: "past" | "current" | "forecast";
  paid: number;
  confirmed: number;
  estimated: number;
  total: number;
  payments: number;
  /** The first year, with fewer payments than the year after it: history
   *  starts part-way through. Marked "*" the way the tape's ribbon marks it. */
  partial: boolean;
  /** Negative percent vs the year before, for a complete past year that paid less. */
  cutPct: number | null;
  flag: Flag | null;
}

/**
 * Dividend per share by calendar year of cash date, gross, in one currency.
 *
 * Past years are paid; the current year is paid so far plus what `upcoming`
 * still expects (confirmed / estimated); then one forecast year. A history row
 * whose cash lands after today is in flight and `upcoming` already carries it,
 * so it is skipped here — counted once. Rows in another currency are left out
 * and counted, never added.
 */
export function perShareByYear(input: {
  history: AssetDividendsDTO["history"];
  upcoming: AssetUpcomingDTO[];
  currency: string;
  todayISO: string;
}): { currency: string; years: YearBar[]; leftOut: number } {
  const { currency, todayISO } = input;
  const thisYear = Number(todayISO.slice(0, 4));
  const slots = new Map<
    number,
    { paid: number; confirmed: number; estimated: number; payments: number }
  >();
  const slot = (y: number) => {
    let s = slots.get(y);
    if (!s) {
      s = { paid: 0, confirmed: 0, estimated: 0, payments: 0 };
      slots.set(y, s);
    }
    return s;
  };
  let leftOut = 0;

  for (const h of input.history) {
    const date = cashDate(h);
    if (date > todayISO) continue;
    if (h.currency !== currency) {
      leftOut++;
      continue;
    }
    const s = slot(Number(date.slice(0, 4)));
    s.paid += Number(h.amountPerShare);
    s.payments++;
  }
  for (const u of input.upcoming) {
    const y = Number(cashDate(u).slice(0, 4));
    if (y > thisYear + 1) continue;
    if (u.currency !== currency) {
      leftOut++;
      continue;
    }
    const s = slot(y);
    s[u.certainty] += Number(u.amountPerShare);
    s.payments++;
  }

  if (slots.size === 0) return { currency, years: [], leftOut };
  const firstYear = Math.min(...slots.keys());
  const startYear = Math.max(firstYear, thisYear - MAX_PAST_YEARS);

  const years: YearBar[] = [];
  for (let y = startYear; y <= thisYear + 1; y++) {
    const s = slots.get(y) ?? { paid: 0, confirmed: 0, estimated: 0, payments: 0 };
    years.push({
      year: y,
      kind: y < thisYear ? "past" : y === thisYear ? "current" : "forecast",
      paid: s.paid,
      confirmed: s.confirmed,
      estimated: s.estimated,
      total: s.paid + s.confirmed + s.estimated,
      payments: s.payments,
      partial: false,
      cutPct: null,
      flag: null,
    });
  }

  const first = years[0];
  const second = years[1];
  if (
    first &&
    first.year === firstYear &&
    second?.kind === "past" &&
    first.payments < second.payments
  ) {
    first.partial = true;
  }

  for (let i = 1; i < years.length; i++) {
    const prev = years[i - 1]!;
    const cur = years[i]!;
    if (prev.partial || prev.total <= 0) continue;
    cur.flag = perShareJumpFlag(cur.total, prev.total);
    if (cur.kind === "past" && cur.total < prev.total) {
      cur.cutPct = (cur.total / prev.total - 1) * 100;
    }
  }

  const last = years[years.length - 1];
  if (last && last.kind === "forecast" && last.total === 0) years.pop();
  return { currency, years, leftOut };
}

/** "2023 was cut 31%", one per cut year. */
export function cutNotes(years: YearBar[]): string[] {
  return years
    .filter((y) => y.cutPct != null)
    .map((y) => `${y.year} was cut ${Math.round(-(y.cutPct as number))}%`);
}
