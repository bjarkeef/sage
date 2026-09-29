"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardTitle, PageShell, EmptyState, buttonVariants } from "@sage/ui";
import { getDashboard, getUserSettings } from "../../lib/api";
import { qk } from "../../lib/query/keys";
import { composeColorLine } from "../../lib/brief";
import { toBriefInput } from "../../lib/brief-input";
import { formatMoney } from "../../lib/format";
import { BriefHeader } from "../../components/brief-header";
import { CurrencyPicker } from "../../components/currency-picker";
import { useDisplayCurrency } from "../../components/display-currency-context";
import { PortfolioChart } from "../../components/portfolio-chart-lazy";
import { TransactionDialog } from "../../components/transaction-dialog";
import { IncomeTape } from "../../components/overview/tape/income-tape";
import { OverviewStatStrip } from "../../components/overview/stat-strip";
import { GoalBand } from "../../components/overview/goal-band";
import { MarketEyebrow } from "../../components/overview/market-eyebrow";
import { PerformanceCard } from "../../components/overview/performance-card";
import { IncomeCard } from "../../components/overview/income-card";
import { PortfolioCard } from "../../components/overview/portfolio-card";
import { UpcomingCard } from "../../components/overview/upcoming-card";
import { NewsCard } from "../../components/overview/news-card";

/** The first screen after sign-up, and the only thing on it: what this page
 *  will become, and the two ways to get there. Import leads — anyone arriving
 *  with a book already has it in a broker CSV, and typing it in one row at a
 *  time is the fallback, not the invitation. */
function OverviewWelcome() {
  return (
    <PageShell>
      <section className="mx-auto max-w-xl py-24 text-center sm:py-32">
        <h1 className="text-2xl font-normal tracking-tight sm:text-3xl">Welcome to Sage.</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Bring in your transactions and this page leads with what your book pays you — the next
          twelve months of dividends, what has already landed, and what is still an estimate.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <Link href="/import" className={buttonVariants({ size: "lg" })}>
            Import from a broker CSV
          </Link>
          <TransactionDialog
            mode="add"
            triggerLabel="Add a single transaction"
            triggerVariant="ghost"
            triggerSize="sm"
          />
        </div>
      </section>
    </PageShell>
  );
}

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

  const ytdPercent = dashboard.ytdTwr != null ? dashboard.ytdTwr * 100 : null;
  const colorSegments = prefs.brief ? composeColorLine(toBriefInput(dashboard, prefs, now)) : [];

  const stream = dashboard.incomeStream;

  // The book's worth, kept on the page but no longer leading it. Only when the
  // book is in one currency: summing across currencies is the thing this app
  // refuses to do everywhere else, and a wrong total is worse than no total.
  // Across currencies the label still renders, against a dash — silently
  // dropping the row would hide that Sage declined to guess rather than
  // saying so.
  // Nothing has ever been entered: no holdings, no income behind or ahead, no
  // value. Every block below this point would then render its own placeholder
  // — a dash under INCOME · NEXT TWELVE MONTHS, "Book value —", an invitation
  // to set a goal that cannot be projected yet, and an empty-state box — four
  // separate ways of saying the same thing on the first screen after sign-up.
  // One welcome replaces them. A book that has been fully sold keeps the real
  // page: it has history to show.
  const neverUsed =
    dashboard.positions.length === 0 &&
    dashboard.incomeStream.length === 0 &&
    dashboard.subtotalsByCurrency.length === 0 &&
    dashboard.history.points.length === 0;

  if (neverUsed) return <OverviewWelcome />;

  const bookValue =
    dashboard.subtotalsByCurrency.length === 1
      ? dashboard.subtotalsByCurrency[0]!.marketValue
      : null;

  return (
    <PageShell>
      {/* The day and the two settings, both quiet: the eyebrow is one glance
          and the controls fade until pointed at. */}
      <header className="mb-14 flex flex-wrap items-center justify-between gap-4 pt-6 sm:mb-20 sm:pt-12">
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

      {/* The income tape: every dividend, first to last forecast, panned
          through time. The figure, the tape, the ribbon and the goal band
          under it are one object, so no card surrounds them. */}
      <section className="mb-20 sm:mb-28">
        {stream.length > 0 ? (
          <IncomeTape
            points={stream}
            todayISO={todayISO}
            taxRate={dashboard.income.dividendTaxRate}
            // The API keeps only points in the headline's currency.
            currency={stream[0]!.currency}
            motionPref={prefs.tapeMotion}
            names={new Map(dashboard.positions.map((p) => [p.symbol, p.name]))}
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
        ) : (
          <div>
            <p className="label-caps mb-2.5 text-muted-foreground">Next 12 months</p>
            <span className="horizon-num">—</span>
          </div>
        )}

        {prefs.goalBand && <GoalBand />}

        {/* What the book is worth, and what it did today — present, small, and
            out of the lead. This is the whole demotion: two facts on one line
            instead of a 108px numeral and three 32px figures under it. */}
        <div className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm text-muted-foreground">
          <span>
            Book value{" "}
            <b className="font-medium tabular-nums text-foreground">
              {bookValue ? formatMoney(bookValue) : "—"}
            </b>
          </span>
          {dashboard.todayChange && (
            <span>
              Today{" "}
              <b
                className={`font-medium tabular-nums ${
                  Number(dashboard.todayChange.amount.amount) < 0 ? "text-loss" : "text-gain"
                }`}
              >
                {Number(dashboard.todayChange.amount.amount) < 0 ? "−" : "+"}
                {formatMoney(dashboard.todayChange.amount).replace(/^-/, "")}
              </b>{" "}
              · {dashboard.todayChange.percent >= 0 ? "+" : "−"}
              {Math.abs(dashboard.todayChange.percent).toFixed(2)}%
            </span>
          )}
          {dashboard.positions.length > 0 && <span>{dashboard.positions.length} holdings</span>}
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
              <Link href="/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Import transactions →
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {prefs.performanceCard && (
            <PerformanceCard
              ytdPercent={ytdPercent}
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
          {/* The value story, in its own place rather than at the top of the
              page. It keeps the one lifetime-gain figure in the app — money in,
              and what the book made on it — beside the line that explains it,
              which is why the Performance card above no longer repeats it.
              Every price-staleness and FX callout rides along inside this
              component, so those system messages left the hero position with
              it. */}
          <Card className="md:col-span-2">
            <PortfolioChart
              variant="ambient"
              initialHistory={dashboard.history}
              displayCurrency={dashboard.displayCurrency}
              todayChange={dashboard.todayChange}
              header={<CardTitle meta="Net worth over time">Value</CardTitle>}
            />
          </Card>
          {/* Portfolio headlines — self-loading and absent until the cache
              warms, so it needs no pref gate the way the always-present
              figure cards do. Spans the row as a quiet footer strip. */}
          <NewsCard />
        </div>
      )}
    </PageShell>
  );
}
