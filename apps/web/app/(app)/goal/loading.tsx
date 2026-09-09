import { PageShell } from "@sage/ui";
import { GoalPageSkeleton } from "../../../components/skeletons";

export default function GoalLoading() {
  return (
    <PageShell animate={false} role="status" aria-label="Loading goal">
      <GoalPageSkeleton />
    </PageShell>
  );
}
