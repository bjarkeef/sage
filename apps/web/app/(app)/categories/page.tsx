import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "../../../lib/query/client";
import { qk } from "../../../lib/query/keys";
import { getCategoriesView, getUserSettings } from "../../../lib/api";
import { CategoriesClient } from "./categories-client";
import CategoriesLoading from "./loading";

/** Server-resolved display currency (spec §7): settings load on the server so
 *  the first paint is already in the user's currency — no client double-fetch. */
export default async function CategoriesPage() {
  const queryClient = getQueryClient();
  const settings = await getUserSettings();
  queryClient.setQueryData(qk.userSettings(), settings);
  const currency = settings.displayCurrency ?? undefined;
  await queryClient.prefetchQuery({
    queryKey: qk.categoriesView(currency ?? null),
    queryFn: () => getCategoriesView(currency),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Drill state comes from `?path=`, and `useSearchParams` needs a
          boundary to suspend against during prerender. */}
      <Suspense fallback={<CategoriesLoading />}>
        <CategoriesClient />
      </Suspense>
    </HydrationBoundary>
  );
}
