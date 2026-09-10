import type { BriefInput } from "./brief";
import { netAnnouncedDividends, netFactor } from "./dividend-tax";
import { formatMoney } from "./format";
import { topMovers } from "./insight";
import type { DashboardDTO, OverviewPrefs, UpcomingRow } from "./types";

const DAY_MS = 86_400_000;

function dayISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
}

/** Maps the dashboard DTO into the pure `composeBrief` input. `now` is passed in
 *  (not read from the clock) so the mapping — and the "today"/"this week" payout
 *  window it derives — stays deterministic and testable.
 *
 *  Paydays are filtered to the display currency before summing: a mixed-currency
 *  total cannot be added honestly, so foreign-currency payouts simply don't
 *  contribute to the payday clause. When `paydayGreeting` is off, no paydays are
 *  reported and the clause never fires.
 *
 *  `recentDividends`/`upcomingDividends` arrive gross from the API (straight off
 *  `income.announced`); both the payday clause and the next-payout clause are
 *  netted here by `dashboard.income.dividendTaxRate` so the greeting matches the
 *  after-tax figures shown elsewhere on Overview. */
export function toBriefInput(dashboard: DashboardDTO, prefs: OverviewPrefs, now: Date): BriefInput {
  const points = dashboard.history.points;
  const lastPoint = points.at(-1);
  const totalValue = lastPoint ? formatMoney(lastPoint.value) : null;

  const todayChange = dashboard.todayChange
    ? { amount: formatMoney(dashboard.todayChange.amount), percent: dashboard.todayChange.percent }
    : null;

  const top = topMovers(dashboard.positions, 1)[0];
  const mover = top
    ? { symbol: top.symbol, percent: top.direction === "down" ? -top.percent : top.percent }
    : null;

  const f = netFactor(dashboard.income.dividendTaxRate);
  const displayCurrency = dashboard.displayCurrency;
  const paydayRows =
    prefs.paydayGreeting && displayCurrency
      ? netAnnouncedDividends(
          dashboard.recentDividends.filter((d) => d.currency === displayCurrency),
          f,
        )
      : [];
  const paydays = paydayRows.map((d) => ({
    symbol: d.symbol,
    income: formatMoney({ amount: d.income, currency: d.currency }),
  }));
  const paydaysTotal =
    paydayRows.length > 0 && displayCurrency
      ? formatMoney({
          amount: paydayRows.reduce((sum, d) => sum + Number(d.income), 0).toString(),
          currency: displayCurrency,
        })
      : null;

  const nextPayout = toNextPayout(
    netAnnouncedDividends(dashboard.upcomingDividends, f)[0],
    dayISO(now),
  );

  return {
    totalValue,
    todayChange,
    mover,
    paydays,
    paydaysTotal,
    nextPayout,
    positionsCount: dashboard.positions.length,
  };
}

function toNextPayout(next: UpcomingRow | undefined, todayISO: string): BriefInput["nextPayout"] {
  if (!next) return null;
  const days = daysBetween(todayISO, next.date);
  if (days === 0) {
    return { symbol: next.symbol, income: formatMoney(moneyOf(next)), when: "today" };
  }
  if (days > 0 && days <= 7) {
    return { symbol: next.symbol, income: formatMoney(moneyOf(next)), when: "thisWeek" };
  }
  return null;
}

function moneyOf(d: UpcomingRow): { amount: string; currency: string } {
  return { amount: d.income, currency: d.currency };
}
