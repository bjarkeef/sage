"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageShell, EmptyState } from "@sage/ui";
import { getDashboard, getUserSettings } from "../../lib/api";
import { qk } from "../../lib/query/keys";
import type { PortfolioHistoryPoint } from "../../lib/types";
import { composeColorLine } from "../../lib/brief";
import { toBriefInput } from "../../lib/brief-input";
import { BriefHeader } from "../../components/brief-header";
import { CurrencyPicker } from "../../components/currency-picker";
import { useDisplayCurrency } from "../../components/display-currency-context";
import { PortfolioChart } from "../../components/portfolio-chart-lazy";
import { TransactionDialog } from "../../components/transaction-dialog";
import { OverviewHero } from "../../components/overview/hero";
import { OverviewStatStrip } from "../../components/overview/stat-strip";
import { GoalBand } from "../../components/overview/goal-band";
import { MarketEyebrow } from "../../components/overview/market-eyebrow";
import { PerformanceCard } from "../../components/overview/performance-card";
import { IncomeCard } from "../../components/overview/income-card";
import { PortfolioCard } from "../../components/overview/portfolio-card";
import { UpcomingCard } from "../../components/overview/upcoming-card";
import { NewsCard } from "../../components/overview/news-card";

export function OverviewClient() {
  const currency = useDisplayCurrency();
  const { data: dashboard } = useQuery({
    queryKey: qk.dashboard(),
    queryFn: () => getDashboard(),
  });
  const { data: settings } = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    staleTime: 300_000,
  });

  // Lifted here rather than kept inside the chart: the hero numeral is a
  // sibling, and the point of the redesign is that dragging the chart rewrites
  // it. Null whenever the pointer is off the plot.
  //
  // Above the `if (!dashboard || !settings) return null` below, and it has to
  // stay there: a hook after an early return runs in a different order on the
  // renders that bail out, which is the one React rule that breaks silently at
  // runtime rather than loudly at build time.
  const [scrubbed, setScrubbed] = React.useState<PortfolioHistoryPoint | null>(null);

  if (!dashboard || !settings) return null; // hydrated on first paint; guards SSR fallback

  const prefs = settings.overviewPrefs;

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  const points = dashboard.history.points;
  // The hero reads the last point of the value series, which is empty until a
  // portfolio has a day of price history behind it. Someone whose only
  // transaction is dated today therefore saw the largest number on the page
  // render as "—" while the change beside it read "+$51.20 (+1.63%) today" and
  // the Portfolio card below showed the value in full. Fall back to the
  // subtotal, which the dashboard already carries.
  //
  // Only when the book is in one currency. Summing across currencies is the
  // thing this app refuses to do anywhere else, and a wrong total is worse than
  // no total — with more than one, "—" is the correct answer, not a stopgap.
  const lastValue =
    points.at(-1)?.value ??
    (dashboard.subtotalsByCurrency.length === 1
      ? dashboard.subtotalsByCurrency[0]!.marketValue
      : null);
  const ytdPercent = dashboard.ytdTwr != null ? dashboard.ytdTwr * 100 : null;
  const colorSegments = prefs.brief ? composeColorLine(toBriefInput(dashboard, prefs, now)) : [];
  return (
    <PageShell>
      {/* The page opens with the day and the two settings, both quiet: the
          eyebrow is one glance and the controls fade until pointed at. What
          used to live here — a greeting, a ticker comment and a market-hours
          note stacked in a 60px band — now sits under the figure as one
          sentence, which is the order a person actually reads them in. */}
      <header className="mb-12 flex flex-wrap items-center justify-between gap-4 pt-6 sm:mb-16 sm:pt-12">
        <MarketEyebrow />
        <div className="flex flex-wrap items-center gap-3 opacity-45 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 sm:shrink-0">
          <CurrencyPicker initialCurrency={currency} />
          <Link
            href="/settings#overview"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Customize
          </Link>
        </div>
      </header>

      <section className="mb-14 sm:mb-20">
        {/* No card. The figure, the line it stands on and the three numbers
            under it are one object, and at this size a surface around them only
            says they are separate from a page that has nothing else on it. The
            plot runs out through the column's gutters — see the `horizon`
            variant — so the chart is the ground rather than a picture. */}
        <PortfolioChart
          variant="horizon"
          initialHistory={dashboard.history}
          displayCurrency={dashboard.displayCurrency}
          todayChange={dashboard.todayChange}
          onScrub={setScrubbed}
          header={
            <OverviewHero
              value={lastValue}
              todayChange={dashboard.todayChange}
              scrubbed={scrubbed}
              brief={
                prefs.brief ? (
                  <BriefHeader
                    layout="inline"
                    segments={colorSegments}
                    marketStateEnabled={false}
                    todayChangePercent={dashboard.todayChange?.percent ?? null}
                  />
                ) : null
              }
            />
          }
        />
        {prefs.goalBand && <GoalBand />}
        {prefs.statStrip && (
          <OverviewStatStrip
            ytdPercent={ytdPercent}
            income={dashboard.income.thisMonth}
            annualIncome={dashboard.income.projectedTwelveMonth}
            totalReturn={dashboard.totalReturn}
            taxRate={dashboard.income.dividendTaxRate}
          />
        )}
      </section>

      {dashboard.positions.length === 0 ? (
        <EmptyState
          // Anyone arriving with a book already has it in a broker CSV, and
          // this is the first screen after sign-up. Offering only the one-at-a-
          // time dialog left them to find Import in the nav on their own.
          message="No holdings yet. Add a transaction, or bring in your whole book from a broker CSV."
          action={
            <div className="flex flex-col items-center gap-3">
              <TransactionDialog mode="add" />
              <Link href="/import" className="text-sm text-primary hover:underline">
                Import transactions →
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {prefs.performanceCard && (
            <PerformanceCard
              ytdPercent={ytdPercent}
              totalReturn={dashboard.totalReturn}
              incomplete={dashboard.ytdTwrIncomplete}
              relative={dashboard.relative}
              benchmarkYtdTwr={dashboard.benchmarkYtdTwr}
            />
          )}
          {prefs.incomeCard && (
            <IncomeCard
              income={dashboard.income.thisMonth}
              annualIncome={dashboard.income.projectedTwelveMonth}
              taxRate={dashboard.income.dividendTaxRate}
            />
          )}
          {prefs.portfolioCard && <PortfolioCard positions={dashboard.positions} />}
          {prefs.upcomingCard && (
            <UpcomingCard
              upcoming={dashboard.upcomingDividends}
              todayISO={todayISO}
              taxRate={dashboard.income.dividendTaxRate}
            />
          )}
          {/* Portfolio headlines — self-loading and absent until the cache
              warms, so it needs no pref gate the way the always-present
              figure cards do. Spans the row as a quiet footer strip. */}
          <NewsCard />
        </div>
      )}
    </PageShell>
  );
}
