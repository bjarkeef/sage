"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardTitle, Chip, ErrorState, PageShell } from "@sage/ui";
import { AppPageHeader } from "../../../components/app-page-header";
import { getCategoriesView, getUserSettings } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { CategoriesEditor } from "./categories-editor";
import { resolvePath, pathOf } from "../../../lib/category-path";
import type { CategoriesViewDTO, CategoryNodeDTO } from "../../../lib/types";
import { CategoryBrowser } from "../../../components/categories/category-browser";
import { CategoriesPageSkeleton } from "../../../components/skeletons";
import { FxStaleCallout } from "../../../components/fx-stale-callout";

/** Drill state lives in the URL so a drilled-in view is linkable and survives
 *  a reload — losing your place on refresh is a small daily annoyance. */
export function hrefFor(trail: CategoryNodeDTO[]): string {
  const path = pathOf(trail);
  return path ? `/categories?path=${path}` : "/categories";
}

export function CategoriesClient() {
  const settingsQuery = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    staleTime: 300_000,
  });
  const displayCurrency = settingsQuery.data?.displayCurrency ?? null;

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: qk.categoriesView(displayCurrency),
    queryFn: () => getCategoriesView(displayCurrency ?? undefined),
    enabled: settingsQuery.isSuccess || settingsQuery.isError,
  });

  const [editing, setEditing] = React.useState(false);

  if (isPending) {
    return (
      <PageShell animate={false}>
        <CategoriesPageSkeleton />
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell>
        <AppPageHeader title="Categories" />
        <ErrorState message="Could not load categories." onRetry={() => void refetch()} />
      </PageShell>
    );
  }

  if (editing) {
    return (
      <CategoriesEditor
        data={data}
        displayCurrency={displayCurrency}
        onClose={() => setEditing(false)}
      />
    );
  }

  return <ReadMode data={data} onEdit={() => setEditing(true)} />;
}

function ReadMode({ data, onEdit }: { data: CategoriesViewDTO; onEdit: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolved = resolvePath(data.root, searchParams.get("path"));

  // A link to a category that has since been deleted or moved lands on the
  // deepest ancestor still there; rewrite the URL so a further drill-down does
  // not rebuild the broken path.
  const truncatedHref = resolved.truncated ? hrefFor(resolved.trail) : null;
  React.useEffect(() => {
    if (truncatedHref) router.replace(truncatedHref);
  }, [router, truncatedHref]);

  return (
    <PageShell>
      <AppPageHeader
        title="Categories"
        description="Group your holdings and track target allocations."
        actions={
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        }
      />

      <CategoryBrowser data={data} resolved={resolved} hrefFor={hrefFor} />

      {data.unallocated.length > 0 && (
        <Card className="mt-5">
          <CardTitle>Unallocated</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {data.unallocated.map((h) => (
              <Chip key={h.symbol}>{h.symbol}</Chip>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Assign these in Edit</p>
        </Card>
      )}

      {data.fxIncomplete && (
        <p className="mt-4 text-xs text-muted-foreground">
          Exchange rates are currently unavailable — amounts in other currencies are shown
          unconverted.
        </p>
      )}
      {data.fxStale && <FxStaleCallout asOf={data.fxRatesAsOf} className="mt-4" />}
    </PageShell>
  );
}
