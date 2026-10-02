"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChartSkeleton, ErrorState, PageShell } from "@sage/ui";
import { AssetPageSkeleton } from "../../../../components/skeletons";
import { getAssetDetail, getAssetRatings, getPortfolio } from "../../../../lib/api";
import { holdingWeight } from "../../../../lib/asset-page/figures";
import type { ChartReadout } from "../../../../lib/asset-chart/readout";
import { toSearchResult } from "../../../../lib/instrument";
import { qk } from "../../../../lib/query/keys";
import { useDividendTaxRate } from "../../../../lib/dividend-tax-hooks";
import { TransactionDialog } from "../../../../components/transaction-dialog";
import { UpdatePriceDialog } from "../../../../components/update-price-dialog";
import { RemoveHoldingButton } from "../../../../components/remove-holding-button";
import { CurrencyPicker } from "../../../../components/currency-picker";
import { useDisplayCurrency } from "../../../../components/display-currency-context";
import { AssetHeader } from "./asset-header";
import { AnswerStrip } from "./answer-strip";
import { PositionSection } from "./position-section";
import { TransactionsSection } from "./transactions-section";
import { IncomeSection } from "./income-section";
import { AboutSection } from "./about-section";
import { FundamentalsSection } from "./fundamentals-section";
import { FundComposition } from "./fund-composition";
import { AnalystRatingsSection } from "./analyst-ratings-section";
import { NewsSection } from "./news-section";

// Deferred so lightweight-charts stays out of the asset route's initial JS; the
// chart is client-only anyway. See components/portfolio-chart-lazy.tsx.
const AssetPriceChart = dynamic(
  () => import("../../../../components/asset-price-chart").then((m) => m.AssetPriceChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

export default function AssetDetailPage() {
  const params = useParams<{ symbol: string }>();
  const slug = decodeURIComponent(params.symbol);
  const currency = useDisplayCurrency();

  const { data, isLoading: assetLoading } = useQuery({
    queryKey: qk.assetDetail(slug),
    queryFn: () => getAssetDetail(slug),
    staleTime: 300_000,
  });
  const { rate: dividendTaxRate, isLoading: taxRateLoading } = useDividendTaxRate();
  const [readout, setReadout] = React.useState<ChartReadout | null>(null);

  // One fetch each, read by every section that needs them (spec: one source
  // per figure). The book only matters for a held symbol; ratings only for a
  // market instrument.
  const held = data?.position.held ?? false;
  const isCustom = data?.custom != null;
  const { data: portfolio } = useQuery({
    queryKey: qk.portfolio(),
    queryFn: () => getPortfolio(),
    staleTime: 300_000,
    enabled: held,
  });
  const { data: ratings } = useQuery({
    queryKey: qk.assetRatings(slug),
    queryFn: () => getAssetRatings(slug),
    staleTime: 300_000,
    enabled: data != null && !isCustom,
  });
  // "Today" for every date rule on the page, read once per mount.
  const todayISO = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  // OR the loading states together (same pattern as the dividends analytics
  // page): the income section below nets its yields off dividendTaxRate, and
  // rendering while the rate is still in flight would show a gross figure
  // mislabeled as "no rate configured" that then silently flips to net.
  const isLoading = assetLoading || taxRateLoading;

  if (isLoading) {
    return (
      <PageShell animate={false}>
        <AssetPageSkeleton />
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <Link href="/holdings" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Holdings
        </Link>
        <div className="mt-8">
          <ErrorState message={`Could not load asset data for ${slug}.`} />
        </div>
      </PageShell>
    );
  }

  const { profile, quote, chart, dividends, position, custom } = data;
  const weight = holdingWeight(portfolio?.positions, profile.symbol);
  const basisMismatch =
    portfolio?.positions.find((p) => p.symbol === profile.symbol)?.basisMismatch ?? null;
  const fund = profile.fund; // const local so narrowing holds inside nested callbacks

  return (
    <PageShell>
      {/* flex-wrap for the same reason as PageHeader's actions row
          (packages/ui/src/components/ui/page-header.tsx): a rigid row next to
          a link runs the page sideways on a phone. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/holdings" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Holdings
        </Link>
        <CurrencyPicker initialCurrency={currency} />
      </div>

      <AssetHeader
        profile={profile}
        quote={quote}
        held={position.held}
        custom={custom}
        readout={readout}
        basisMismatch={basisMismatch}
      />
      {(position.held || custom) && (
        <div className="mb-8 flex items-center justify-between gap-3 border-b border-hairline pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <TransactionDialog
              mode="add"
              instrument={toSearchResult(profile)}
              triggerVariant="secondary"
              triggerSize="sm"
            />
            {custom && <UpdatePriceDialog symbol={profile.symbol} currency={profile.currency} />}
          </div>
          {position.held && <RemoveHoldingButton symbol={profile.symbol} />}
        </div>
      )}
      {!custom && (
        <AnswerStrip
          detail={data}
          taxRate={dividendTaxRate}
          todayISO={todayISO}
          weight={weight}
          ratings={ratings}
          addAction={
            <TransactionDialog
              mode="add"
              instrument={toSearchResult(profile)}
              triggerVariant="secondary"
              triggerSize="sm"
            />
          }
        />
      )}
      <section className="mb-10">
        <AssetPriceChart
          slug={slug}
          initialChart={chart}
          position={position}
          dividends={dividends.history}
          onReadout={setReadout}
        />
      </section>
      <PositionSection position={position} weight={weight} />
      <IncomeSection detail={data} taxRate={dividendTaxRate} todayISO={todayISO} />
      <AboutSection profile={profile} />

      <FundamentalsSection profile={profile} />
      {fund && <FundComposition fund={fund} />}
      <AnalystRatingsSection slug={slug} />
      {/* Your own entries, immediately before the payment history they explain:
          the two ledgers read together, and both sit below the research
          sections rather than interrupting them. */}
      <TransactionsSection symbol={profile.symbol} held={position.held || custom != null} />
      <NewsSection slug={slug} />
    </PageShell>
  );
}
