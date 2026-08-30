"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AllocationBars,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  PageShell,
  Switch,
} from "@sage/ui";
import { AppPageHeader } from "../../../components/app-page-header";
import { getDiversification, getUserSettings } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { formatMoney } from "../../../lib/format";
import {
  aggregateConstituents,
  aggregateDimension,
  aggregateHoldings,
  selectSectorRows,
  type Basis,
  type BucketRow,
} from "../../../lib/diversification";
import { DiversificationPageSkeleton } from "../../../components/skeletons";
import { FxStaleCallout } from "../../../components/fx-stale-callout";

function toAllocationRows(buckets: BucketRow[], currency: string) {
  return buckets.map((bucket) => ({
    label: bucket.label,
    percent: bucket.percent,
    value: formatMoney({ amount: bucket.amount.toFixed(2), currency }),
  }));
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  // Name the switch from the visible text (single source) instead of
  // duplicating it into an aria-label, which screen readers announce twice.
  const labelId = useId();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={labelId} />
      <span id={labelId}>{label}</span>
    </label>
  );
}

function HoldingRows({ buckets }: { buckets: BucketRow[] }) {
  return (
    <div className="mt-4 space-y-3 border-t border-hairline-faint pt-3">
      {buckets.map((bucket) => (
        <div key={bucket.label}>
          <p className="label-caps text-muted-foreground">{bucket.label}</p>
          {bucket.holdings.map((holding, i) => (
            <div
              key={`${holding.symbol ?? holding.name}-${holding.label}-${i}`}
              className="flex items-baseline justify-between gap-3 py-1"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{holding.label}</span>
              <span className="font-mono text-data tabular-nums text-muted-foreground">
                {holding.percentOfBucket.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DiversificationClient() {
  const [xray, setXray] = useState(false);
  const [buyIn, setBuyIn] = useState(false);
  const [showHoldings, setShowHoldings] = useState(false);

  const settingsQuery = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    staleTime: 300_000,
  });
  const displayCurrency = settingsQuery.data?.displayCurrency ?? null;

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: qk.diversification(displayCurrency),
    queryFn: () => getDiversification(displayCurrency ?? undefined),
    enabled: settingsQuery.isSuccess || settingsQuery.isError,
  });

  if (isPending) {
    return (
      <PageShell>
        <DiversificationPageSkeleton />
      </PageShell>
    );
  }

  if (isError || !data) {
    return (
      <PageShell>
        <AppPageHeader title="Diversification" />
        <ErrorState message="Could not load diversification data." onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  const basis: Basis = buyIn ? "cost" : "market";
  const dims = data.dimensions;
  const hasPositions = dims.currency.length > 0;

  const allHoldings = xray
    ? aggregateConstituents(data.holdingsXray, basis)
    : aggregateHoldings(dims.currency, basis);

  const cards: { key: string; title: string; buckets: BucketRow[]; wide?: boolean }[] = [
    {
      key: "sector",
      title: "By sector",
      buckets: aggregateDimension(selectSectorRows(dims.sector, xray), basis),
      wide: true,
    },
    { key: "country", title: "By country", buckets: aggregateDimension(dims.country, basis) },
    { key: "region", title: "By region", buckets: aggregateDimension(dims.region, basis) },
    {
      key: "assetClass",
      title: "By asset class",
      buckets: aggregateDimension(dims.assetClass, basis),
    },
    { key: "currency", title: "By currency", buckets: aggregateDimension(dims.currency, basis) },
  ];

  const hasUnknown = cards.some(({ buckets }) => buckets.some((b) => b.label === "Unknown"));

  // Every card below returns null when its bucket list is empty, so an empty
  // book rendered a title, a subtitle and three toggles over a void — the only
  // page in the app with no empty state. Three switches with nothing to switch
  // are worse than none: they suggest the page is broken rather than waiting.
  if (!hasPositions) {
    return (
      <PageShell>
        <AppPageHeader title="Diversification" description="How your portfolio is spread." />
        <EmptyState
          message="Nothing to spread yet. Add a holding or import your transactions, and this page will break them down by sector, country, asset class and currency."
          action={
            <Link href="/import" className="text-sm text-primary hover:underline">
              Import transactions →
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AppPageHeader title="Diversification" description="How your portfolio is spread." />
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <ToggleField label="X-Ray funds" checked={xray} onChange={setXray} />
        <ToggleField label="Buy in" checked={buyIn} onChange={setBuyIn} />
        <ToggleField label="Show holdings" checked={showHoldings} onChange={setShowHoldings} />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardTitle
            meta={`${allHoldings.length} ${allHoldings.length === 1 ? "holding" : "holdings"}`}
          >
            All holdings
          </CardTitle>
          <AllocationBars
            title="All holdings"
            rows={toAllocationRows(allHoldings, data.currency)}
            variant="bar"
            hideTitle
            maxRows={12}
          />
          {showHoldings && xray && <HoldingRows buckets={allHoldings} />}
        </Card>
        {cards.map(({ key, title, buckets, wide }) => {
          if (buckets.length === 0) return null;
          return (
            <Card key={key} className={wide ? "md:col-span-2" : undefined}>
              <CardTitle meta={`${buckets.length} ${buckets.length === 1 ? "bucket" : "buckets"}`}>
                {title}
              </CardTitle>
              <AllocationBars
                title={title}
                rows={toAllocationRows(buckets, data.currency)}
                variant="bar"
                hideTitle
              />
              {showHoldings && <HoldingRows buckets={buckets} />}
            </Card>
          );
        })}
      </div>
      {hasUnknown && (
        <p className="mt-4 text-xs text-muted-foreground">
          Buckets marked “Unknown” are holdings Sage has no classification data for yet.
        </p>
      )}
      {xray && (
        <p className="mt-1 text-xs text-muted-foreground">
          Fund look-through uses each fund’s latest reported composition.
        </p>
      )}
      {data.fxIncomplete && (
        <p className="mt-1 text-xs text-muted-foreground">
          Exchange rates are currently unavailable — amounts in other currencies are shown
          unconverted.
        </p>
      )}
      {data.fxStale && <FxStaleCallout asOf={data.fxRatesAsOf} className="mt-1" />}
    </PageShell>
  );
}
