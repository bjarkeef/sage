import { PageShell } from "@sage/ui";
import { OverviewPageSkeleton } from "../../components/skeletons";

/** Mirrors the default overview layout (stat strip off): greeting header, value
 *  hero, ambient chart block, then a 2x2 grid of cards. Reserves the same shape
 *  and heights the loaded page occupies so data arriving causes no layout shift. */
export default function OverviewLoading() {
  return (
    <PageShell animate={false} role="status" aria-label="Loading overview">
      <OverviewPageSkeleton />
    </PageShell>
  );
}
