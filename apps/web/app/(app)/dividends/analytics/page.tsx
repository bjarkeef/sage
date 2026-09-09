// apps/web/app/(app)/dividends/analytics/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { PageShell, buttonVariants, ChartSkeleton } from "@sage/ui";
import { AppPageHeader } from "../../../../components/app-page-header";
import { getPortfolio } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { computePortfolioYields, computeGrossForwardYield } from "../../../../lib/portfolio-yields";
import { yieldByHolding, monthlyRhythm } from "../../../../lib/dividend-derive";
import { incomeTimeline } from "../../../../lib/dividend-year";
import { useNetDividendIncome } from "../../../../lib/dividend-tax-hooks";
import { TaxBasisNote } from "../../../../components/tax-basis-note";
import {
  AnnualIncomeCard,
  YieldCard,
  CashFlowCard,
  type UpcomingPayment,
} from "../../../../components/dividend/kpi-cards";
import { HoldingsDividendTable } from "../../../../components/dividend/holdings-dividend-table";
import { AnalyticsPageSkeleton } from "../../../../components/skeletons";
import { FxUnavailableCallout } from "../../../../components/fx-unavailable-callout";
import { FxStaleCallout } from "../../../../components/fx-stale-callout";

// Recharts charts — deferred so this route does not bloat non-analytics pages.
// See docs/CHARTS.md (keep LWC for time series; recharts for categorical).
const chartLoading = () => <ChartSkeleton className="h-64" />;
const IncomeComposition = dynamic(
  () =>
    import("../../../../components/dividend/income-composition").then((m) => m.IncomeComposition),
  { ssr: false, loading: chartLoading },
);
const IncomeTimeline = dynamic(
  () => import("../../../../components/dividend/income-timeline").then((m) => m.IncomeTimeline),
  { ssr: false, loading: chartLoading },
);
const ForwardPayments = dynamic(
  () => import("../../../../components/dividend/forward-payments").then((m) => m.ForwardPayments),
  { ssr: false, loading: chartLoading },
);
const MonthlyRhythm = dynamic(
  () => import("../../../../components/dividend/monthly-rhythm").then((m) => m.MonthlyRhythm),
  { ssr: false, loading: chartLoading },
);
const YieldByHolding = dynamic(
  () => import("../../../../components/dividend/yield-by-holding").then((m) => m.YieldByHolding),
  { ssr: false, loading: chartLoading },
);
const GrowthLeaders = dynamic(
  () => import("../../../../components/dividend/growth-leaders").then((m) => m.GrowthLeaders),
  { ssr: false, loading: chartLoading },
);

/** "MMM D" (e.g. "Jul 24") for the cash-flow card's upcoming-payment rows. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DividendAnalyticsPage() {
  // Netted payload — every figure on this page is after-tax. The Yield card is
  // the one exception and takes its gross input separately below, which is why
  // `factor` comes out of the hook too.
  const {
    data: income,
    gross: grossIncome,
    isLoading: incomeLoading,
    factor,
    taxed,
  } = useNetDividendIncome();
  const { data: portfolio, isLoading: portfolioLoading } = useQuery({
    queryKey: qk.portfolio(),
    queryFn: () => getPortfolio(),
  });

  const loading = incomeLoading || portfolioLoading;

  // FORWARD (projected next-12-months) is the headline basis — it matches the
  // donut, the yield card, and "Next 12 months", so every income figure on the
  // page reconciles to one number. Trailing (actually received) is kept for two
  // things only: the "vs last 12m" comparison on the annual-income card, and
  // the display currency the timeline and the monthly-rhythm chart format in.
  const trailing = income?.summary.trailingTwelveMonthIncome[0] ?? null;
  const forward = income?.summary.projectedTwelveMonthIncome[0] ?? null;
  const forwardAmount = forward ? Number(forward.amount) : 0;
  const monthly = forward
    ? { amount: (forwardAmount / 12).toFixed(2), currency: forward.currency }
    : null;
  // Projected income vs what actually landed over the trailing 12 months.
  const forwardVsTrailingPct =
    forward && trailing && Number(trailing.amount) > 0
      ? ((forwardAmount - Number(trailing.amount)) / Number(trailing.amount)) * 100
      : null;

  // Yield on cost, netted the same way the sibling /dividends page does:
  // compute gross from the (untaxed) portfolio positions, then scale by the
  // same net factor as every other figure on this after-tax page.
  const onCostGross = portfolio ? computePortfolioYields(portfolio.positions).yieldOnCost : null;
  const onCost = onCostGross == null ? null : onCostGross * factor;

  // Display currency for the forward-payments card, falling back through the
  // forward/trailing figures to the portfolio's own currency so amounts never
  // render as "$" for a kr-denominated book.
  const displayCurrency =
    forward?.currency ?? trailing?.currency ?? portfolio?.subtotalsByCurrency[0]?.currency ?? "USD";

  // Gross (pre-tax) forward yield, currency-safe (see computeGrossForwardYield):
  // Σ forwardAnnualIncome ÷ Σ marketValue over holdings with marketValue > 0.
  // Falls back to null (rendered as "—") when not computable single-currency
  // rather than summing mixed-currency market values.
  //
  // The Yield card shows gross beside net, so it needs the pre-tax basis.
  // Computed straight from the un-netted `gross.perHolding` the hook exposes
  // alongside the netted `data` — NOT by dividing the netted figure back out
  // by `factor`, which is unsafe at a 100% tax rate (factor 0 → 0/0 = NaN).
  const grossForwardYield = React.useMemo(() => {
    if (!grossIncome || !portfolio) return null;
    return computeGrossForwardYield(grossIncome.perHolding, portfolio.positions);
  }, [grossIncome, portfolio]);

  const payers = income
    ? income.perHolding.filter((h) => Number(h.forwardAnnualIncome.amount) > 0).length
    : 0;

  // Today's month, anchoring the ForwardPayments card's twelve-month window.
  // That card is this page's own chart; /dividends charts a picked calendar
  // year through DividendIncomeBars instead.
  const currentMonth = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const yieldRows = React.useMemo(() => {
    if (!income || !portfolio) return [];
    return yieldByHolding(income.perHolding, portfolio.positions);
  }, [income, portfolio]);

  const rhythmRows = React.useMemo(() => {
    if (!income) return [];
    return monthlyRhythm(income.retroactive);
  }, [income]);

  const timelinePoints = React.useMemo(
    () =>
      incomeTimeline(
        income?.summary.receivedByYear ?? [],
        income?.summary.monthlyBreakdown ?? [],
        new Date(),
      ),
    [income],
  );

  const upcoming: UpcomingPayment[] = React.useMemo(() => {
    if (!income) return [];
    const rows = [
      ...income.announced.map((a) => ({
        symbol: a.symbol,
        date: a.paymentDate ?? a.exDate,
        amount: { amount: a.income, currency: a.currency },
      })),
      ...income.projected.map((p) => ({
        symbol: p.symbol,
        date: p.paymentDate ?? p.projectedExDate,
        amount: { amount: p.income, currency: p.currency },
      })),
    ];
    return rows
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3)
      .map((r) => ({ ...r, date: shortDate(r.date) }));
  }, [income]);

  if (loading) {
    return (
      <PageShell>
        <AnalyticsPageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AppPageHeader
        title="Dividend analytics"
        description={incomeLoading ? null : <TaxBasisNote rate={income?.dividendTaxRate ?? null} />}
        actions={
          <Link href="/dividends" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            ← Dividends
          </Link>
        }
      />

      {income?.fxIncomplete && <FxUnavailableCallout className="mb-4" />}
      {income?.fxStale && <FxStaleCallout asOf={income?.fxRatesAsOf} className="mb-4" />}

      {income && (
        <div className="grid grid-cols-12 gap-4">
          {/* KPI row */}
          <div className="col-span-12 md:col-span-4">
            <AnnualIncomeCard amount={forward} yoyPct={forwardVsTrailingPct} payers={payers} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <YieldCard gross={grossForwardYield} taxRate={income.dividendTaxRate} onCost={onCost} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <CashFlowCard monthly={monthly} upcoming={upcoming} />
          </div>

          {/* Income composition donut (holdings/sector/currency toggle) */}
          <div className="col-span-12 md:col-span-5">
            <IncomeComposition groups={income.incomeByGroup} />
          </div>
          {/* The income timeline — received per year, plus the year in progress */}
          <div className="col-span-12 md:col-span-7">
            <IncomeTimeline
              points={timelinePoints}
              currency={trailing?.currency ?? "USD"}
              incomeRecordingOff={income.incomeRecordingOff}
              taxed={taxed}
            />
          </div>

          {/* Next 12 months — forward payments by month */}
          <div className="col-span-12 md:col-span-7">
            <ForwardPayments
              retroactive={income.retroactive}
              announced={income.announced}
              projected={income.projected}
              currentMonth={currentMonth}
              currency={displayCurrency}
              taxed={taxed}
            />
          </div>
          {/* Dividend growth leaders — 5y CAGR */}
          <div className="col-span-12 md:col-span-5">
            <GrowthLeaders perHolding={income.perHolding} />
          </div>

          {/* Yield by holding */}
          <div className="col-span-12 md:col-span-6">
            <YieldByHolding rows={yieldRows} taxed={taxed} />
          </div>
          {/* Monthly rhythm — trailing 12 received per month */}
          <div className="col-span-12 md:col-span-6">
            <MonthlyRhythm rows={rhythmRows} currency={trailing?.currency} taxed={taxed} />
          </div>
          {/* Consolidated holdings table — Annual, share-of-income bar,
              Yield, Yield on cost, Growth (CAGR); rows link to /asset/[symbol]. */}
          <div className="col-span-12">
            <HoldingsDividendTable
              perHolding={income.perHolding}
              positions={portfolio?.positions ?? []}
              factor={factor}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
