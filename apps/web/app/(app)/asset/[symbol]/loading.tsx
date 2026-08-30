import { PageShell } from "@sage/ui";
import { AssetPageSkeleton } from "../../../../components/skeletons";

export default function AssetLoading() {
  return (
    <PageShell role="status" aria-label="Loading asset">
      <AssetPageSkeleton />
    </PageShell>
  );
}
