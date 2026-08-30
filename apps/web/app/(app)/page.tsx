import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "../../lib/query/client";
import { qk } from "../../lib/query/keys";
import { getDashboard, getUserSettings } from "../../lib/api";
import { OverviewClient } from "./overview-client";

export default async function OverviewPage() {
  const queryClient = getQueryClient();
  // YTD TWR ships on the dashboard DTO — no separate /performance prefetch.
  await Promise.all([
    queryClient.prefetchQuery({ queryKey: qk.dashboard(), queryFn: () => getDashboard() }),
    queryClient.prefetchQuery({ queryKey: qk.userSettings(), queryFn: getUserSettings }),
  ]);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OverviewClient />
    </HydrationBoundary>
  );
}
