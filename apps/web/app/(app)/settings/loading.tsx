import { PageShell } from "@sage/ui";
import { SettingsPageSkeleton } from "../../../components/skeletons";

export default function SettingsLoading() {
  return (
    <PageShell
      animate={false}
      width="narrow"
      className="py-10"
      role="status"
      aria-label="Loading settings"
    >
      <SettingsPageSkeleton />
    </PageShell>
  );
}
