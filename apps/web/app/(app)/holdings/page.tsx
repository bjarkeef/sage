import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "../../../lib/query/client";
import { qk } from "../../../lib/query/keys";
import { getPortfolio } from "../../../lib/api";
import { HoldingsClient } from "./holdings-client";

export default async function HoldingsPage() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({ queryKey: qk.portfolio(), queryFn: () => getPortfolio() });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HoldingsClient />
    </HydrationBoundary>
  );
}
