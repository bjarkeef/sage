import { PageShell } from "@sage/ui";
import { DividendsPageSkeleton } from "../../../components/skeletons";

export default function DividendsLoading() {
  return (
    <PageShell animate={false} role="status" aria-label="Loading dividends">
      <DividendsPageSkeleton />
    </PageShell>
  );
}
