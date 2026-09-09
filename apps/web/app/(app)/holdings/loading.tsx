import { PageShell } from "@sage/ui";
import { HoldingsPageSkeleton } from "../../../components/skeletons";

export default function HoldingsLoading() {
  return (
    <PageShell animate={false} role="status" aria-label="Loading holdings">
      <HoldingsPageSkeleton />
    </PageShell>
  );
}
