import { PageShell } from "@sage/ui";
import { NewsPageSkeleton } from "../../../components/skeletons";

export default function NewsLoading() {
  return (
    <PageShell animate={false}>
      <NewsPageSkeleton />
    </PageShell>
  );
}
