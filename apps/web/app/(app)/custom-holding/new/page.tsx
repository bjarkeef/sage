import { PageHeader, PageShell } from "@sage/ui";
import { CustomHoldingForm } from "../../../../components/custom-holding-form";

export default function NewCustomHoldingPage() {
  return (
    <PageShell>
      <PageHeader
        title="Add custom holding"
        description="Track a savings account, pension, or any asset without a market feed."
      />
      <CustomHoldingForm mode="create" />
    </PageShell>
  );
}
