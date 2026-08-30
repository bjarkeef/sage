import { PageShell } from "@sage/ui";
import { AnalyticsPageSkeleton } from "../../../../components/skeletons";

export default function AnalyticsLoading() {
  return (
    <PageShell role="status" aria-label="Loading dividend analytics">
      <AnalyticsPageSkeleton />
    </PageShell>
  );
}
