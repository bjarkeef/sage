"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  ChartSkeleton,
  EmptyState,
  PageHeader,
  PageShell,
  RowGrid,
  RowHeader,
  SectionHeader,
} from "@sage/ui";
import { getCorporateActions } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { ACTION_ROW_COLUMNS, ActionRow } from "./action-row";

export default function CorporateActionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.corporateActions(),
    queryFn: () => getCorporateActions(),
    staleTime: 300_000,
  });

  return (
    <PageShell>
      <PageHeader
        title="Corporate actions"
        description="Splits and similar events in your ledger, and what Sage did about each one."
      />
      {isLoading && <ChartSkeleton />}
      {data && data.actions.length === 0 && (
        <EmptyState message="No corporate actions in your ledger. Sage will list splits and similar events here when it finds one." />
      )}
      {data && data.actions.length > 0 && (
        <>
          <SectionHeader
            title="In your ledger"
            meta={`Checked ${data.coverage.checked} of ${data.coverage.total} trades against stored prices`}
          />
          <Card>
            <RowGrid columns={ACTION_ROW_COLUMNS}>
              <RowHeader cells={["Holding", "Date", "Ratio", "What Sage did"]} />
              {data.actions.map((a) => (
                <ActionRow key={`${a.symbol}-${a.date}`} action={a} />
              ))}
            </RowGrid>
          </Card>
        </>
      )}
    </PageShell>
  );
}
