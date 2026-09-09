"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChartSkeleton, ErrorState, PageShell } from "@sage/ui";
import { AssetPageSkeleton } from "../../../../components/skeletons";
import { getAssetDetail } from "../../../../lib/api";
import { toSearchResult } from "../../../../lib/instrument";
import { qk } from "../../../../lib/query/keys";
import { useDividendTaxRate } from "../../../../lib/dividend-tax-hooks";
import { TransactionDialog } from "../../../../components/transaction-dialog";
import { UpdatePriceDialog } from "../../../../components/update-price-dialog";
import { RemoveHoldingButton } from "../../../../components/remove-holding-button";
import { CurrencyPicker } from "../../../../components/currency-picker";
import { useDisplayCurrency } from "../../../../components/display-currency-context";
import { AssetHeader } from "./asset-header";
import { PositionSection } from "./position-section";
import { TransactionsSection } from "./transactions-section";
import { IncomeSection } from "./income-section";
import { AboutSection } from "./about-section";
import { FundamentalsSection } from "./fundamentals-section";
import { FundComposition } from "./fund-composition";
import { DividendHistory } from "./dividend-history";
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

  const { profile, quote, chart, dividends, position, income, custom } = data;
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

      <AssetHeader profile={profile} quote={quote} held={position.held} custom={custom} />
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
      <section className="mb-10">
        <AssetPriceChart slug={slug} initialChart={chart} position={position} />
      </section>
      <PositionSection
        position={position}
        currency={profile.currency}
        symbol={profile.symbol}
        taxRate={dividendTaxRate}
      />
      <IncomeSection income={income} custom={custom} taxRate={dividendTaxRate} />
      <AboutSection profile={profile} />

      <FundamentalsSection profile={profile} />
      {fund && <FundComposition fund={fund} />}
      <AnalystRatingsSection slug={slug} />
      {/* Your own entries, immediately before the payment history they explain:
          the two ledgers read together, and both sit below the research
          sections rather than interrupting them. */}
      <TransactionsSection symbol={profile.symbol} held={position.held || custom != null} />
      <DividendHistory dividends={dividends} currency={profile.currency} />
      <NewsSection slug={slug} />
    </PageShell>
  );
}
