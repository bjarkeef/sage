"use client";

import { useParams } from "next/navigation";
import { PageHeader, PageShell } from "@sage/ui";
import { CustomHoldingForm } from "../../../../../components/custom-holding-form";

export default function EditCustomHoldingPage() {
  const params = useParams<{ symbol: string }>();
  const slug = decodeURIComponent(params.symbol);

  return (
    <PageShell>
      <PageHeader title="Edit custom holding" description={slug} />
      <CustomHoldingForm mode="edit" symbol={slug} />
    </PageShell>
  );
}
