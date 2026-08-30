import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "../../../lib/query/client";
import { qk } from "../../../lib/query/keys";
import { getDiversification, getUserSettings } from "../../../lib/api";
import { DiversificationClient } from "./diversification-client";

/** Server-resolved display currency (spec §7): settings load on the server so
 *  the first paint is already in the user's currency — no client double-fetch. */
export default async function DiversificationPage() {
  const queryClient = getQueryClient();
  const settings = await getUserSettings();
  queryClient.setQueryData(qk.userSettings(), settings);
  const currency = settings.displayCurrency ?? undefined;
  await queryClient.prefetchQuery({
    queryKey: qk.diversification(currency ?? null),
    queryFn: () => getDiversification(currency),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DiversificationClient />
    </HydrationBoundary>
  );
}
