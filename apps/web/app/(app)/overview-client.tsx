"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageShell, EmptyState } from "@sage/ui";
import { getDashboard, getUserSettings } from "../../lib/api";
import { qk } from "../../lib/query/keys";
import { composeColorLine } from "../../lib/brief";
import { toBriefInput } from "../../lib/brief-input";
import { BriefHeader } from "../../components/brief-header";
import { CurrencyPicker } from "../../components/currency-picker";
import { useDisplayCurrency } from "../../components/display-currency-context";
import { PortfolioChart } from "../../components/portfolio-chart-lazy";
import { TransactionDialog } from "../../components/transaction-dialog";
import { OverviewHero } from "../../components/overview/hero";
import { OverviewStatStrip } from "../../components/overview/stat-strip";
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
      {/* Wraps at both levels, same reasoning as PageHeader's actions row
          (packages/ui/src/components/ui/page-header.tsx): a rigid group next
          to a flexible title runs the page sideways on a phone. */}
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <BriefHeader
          segments={colorSegments}
          marketStateEnabled={prefs.marketState}
          todayChangePercent={dashboard.todayChange?.percent ?? null}
        />
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
          <CurrencyPicker initialCurrency={currency} />
          <Link
            href="/settings#overview"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Customize
          </Link>
        </div>
      </header>

      <section className="mb-8">
        <OverviewHero value={lastValue} todayChange={dashboard.todayChange} />
        <div className="mt-4">
          <PortfolioChart
            variant="ambient"
            initialHistory={dashboard.history}
            displayCurrency={dashboard.displayCurrency}
            todayChange={dashboard.todayChange}
          />
        </div>
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
