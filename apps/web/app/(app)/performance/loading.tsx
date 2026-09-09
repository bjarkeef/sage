import { PageShell } from "@sage/ui";
import { PerformancePageSkeleton } from "../../../components/skeletons";

/** Route-level skeleton for /performance. Mirrors the studio's layout order
 *  (hero -> stats -> chart). */
export default function PerformanceLoading() {
  return (
    <PageShell animate={false}>
      <PerformancePageSkeleton />
    </PageShell>
  );
}
