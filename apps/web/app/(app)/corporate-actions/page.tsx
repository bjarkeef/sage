"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  RowGrid,
  RowHeader,
  SectionHeader,
} from "@sage/ui";
import { getCorporateActions } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { RowsSkeleton } from "../../../components/skeletons";
import { ACTION_ROW_COLUMNS, ActionRow } from "./action-row";

export default function CorporateActionsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
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
      {/* Table-shaped, not chart-shaped: rows of holding/date/ratio/verdict,
          which is exactly what RowsSkeleton mirrors. */}
      {isLoading && <RowsSkeleton rows={5} />}
      {isError && (
        <ErrorState message="Could not load corporate actions." onRetry={() => void refetch()} />
      )}
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
            {/* `min-w-0` is load-bearing, not defensive tidying: this div is a
                flex item of the Card's flex-col, whose default `min-width:
                auto` refuses to shrink below the row grid's content width.
                Without it `overflow-x-auto` never engages and the card pushes
                `main` sideways instead on a narrow phone — ACTION_ROW_COLUMNS
                needs ~410px and a 375px viewport leaves ~295px inside Card +
                PageShell. /categories shipped exactly this bug; see
                goal-results-table.tsx for the same idiom. */}
            <div className="min-w-0 overflow-x-auto">
              <RowGrid columns={ACTION_ROW_COLUMNS}>
                <RowHeader cells={["Holding", "Date", "Ratio", "What Sage did"]} />
                {data.actions.map((a, i) => (
                  // symbol+date alone collides when a symbol carries two
                  // splits on the same date; the index breaks the tie.
                  <ActionRow key={`${a.symbol}-${a.date}-${i}`} action={a} />
                ))}
              </RowGrid>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}
