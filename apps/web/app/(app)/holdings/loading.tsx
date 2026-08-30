import { PageShell } from "@sage/ui";
import { HoldingsPageSkeleton } from "../../../components/skeletons";

export default function HoldingsLoading() {
  return (
    <PageShell role="status" aria-label="Loading holdings">
      <HoldingsPageSkeleton />
    </PageShell>
  );
}
