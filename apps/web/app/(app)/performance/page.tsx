import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { PageShell } from "@sage/ui";
import { getQueryClient } from "../../../lib/query/client";
import { qk } from "../../../lib/query/keys";
import { getPerformance } from "../../../lib/api";
import { PerformanceStudio } from "../../../components/performance-studio-lazy";
import { PerformanceEmptyState } from "../../../components/performance-stats";
import { AppPageHeader } from "../../../components/app-page-header";

export default async function PerformancePage() {
  const queryClient = getQueryClient();
  const perf = await queryClient.fetchQuery({
    queryKey: qk.performance("1Y"),
    queryFn: () => getPerformance("1Y"),
  });

  return (
    <PageShell>
      <AppPageHeader
        title="Performance"
        description="How the book has done, and what it has made since you started."
      />
      {perf.insufficientData ? (
        <PerformanceEmptyState />
      ) : (
        <div className="mt-6">
          <HydrationBoundary state={dehydrate(queryClient)}>
            <PerformanceStudio />
          </HydrationBoundary>
        </div>
      )}
    </PageShell>
  );
}
