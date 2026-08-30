import { PageShell } from "@sage/ui";
import { ImportPageSkeleton } from "../../../components/skeletons";

// ImportPage's own steps never gate on an async fetch at mount (the wizard
// starts on step "upload" synchronously), so this only paints during the
// route transition itself — there is no in-page loading branch to pair it
// with, unlike /goal or /dividends.
export default function ImportLoading() {
  return (
    <PageShell className="py-10">
      <ImportPageSkeleton />
    </PageShell>
  );
}
