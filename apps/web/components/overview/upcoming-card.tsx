import { BasisChip, Card, CardTitle } from "@sage/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { netAnnouncedDividends, netFactor } from "../../lib/dividend-tax";
import type { UpcomingRow } from "../../lib/types";

export function UpcomingCard({
  upcoming,
  todayISO,
  taxRate,
}: {
  /** Raw (gross) from the dashboard DTO — netted internally, same convention
   *  as the sibling IncomeCard/OverviewStatStrip. Task 11 owns rendering the
   *  `~` estimated-date mark, the announced/projected legend, and the
   *  30-day window label this shape now carries (`dateEstimated`, `projected`)
   *  — this component still renders it as announced-only for now. */
  upcoming: UpcomingRow[];
  todayISO: string;
  taxRate: number | null;
}) {
  const rows = netAnnouncedDividends(upcoming, netFactor(taxRate)).slice(0, 3);
  const taxed = taxRate != null;
  return (
    <Card>
      <div className="mb-3">
        <CardTitle
          className="mb-0"
          meta={rows.length > 0 ? <BasisChip taxed={taxed} /> : undefined}
        >
          Upcoming
        </CardTitle>
        {rows.length > 0 && (
          <div className="text-xs text-muted-foreground">{rows.length} announced</div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No dividends scheduled.</div>
      ) : (
        rows.map((d) => {
          const date = d.date;
          const isToday = date === todayISO;
          return (
            <div
              key={`${d.symbol}-${date}`}
              className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2 text-sm last:border-b-0"
            >
              <span className="label-caps text-muted-foreground">{formatDate(date)}</span>
              <span className="flex-1 truncate font-medium">{d.symbol}</span>
              <span
                className={`font-mono text-xs tabular-nums ${isToday ? "text-income" : "text-muted-foreground"}`}
              >
                ≈ {formatMoney({ amount: d.income, currency: d.currency })}
              </span>
            </div>
          );
        })
      )}
    </Card>
  );
}
