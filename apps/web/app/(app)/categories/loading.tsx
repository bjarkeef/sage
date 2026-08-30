import { PageShell } from "@sage/ui";
import { CategoriesPageSkeleton } from "../../../components/skeletons";

export default function CategoriesLoading() {
  return (
    <PageShell role="status" aria-label="Loading categories">
      <CategoriesPageSkeleton />
    </PageShell>
  );
}
