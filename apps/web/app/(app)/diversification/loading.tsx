import { PageShell } from "@sage/ui";
import { DiversificationPageSkeleton } from "../../../components/skeletons";

export default function DiversificationLoading() {
  return (
    <PageShell role="status" aria-label="Loading diversification">
      <DiversificationPageSkeleton />
    </PageShell>
  );
}
