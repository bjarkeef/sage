import { Card, CardTitle, InfoTooltip } from "@sage/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { netAnnouncedDividends, netFactor } from "../../lib/dividend-tax";
import type { AnnouncedDividendDTO } from "../../lib/types";

export function UpcomingCard({
  upcoming,
  todayISO,
  taxRate,
}: {
  /** Raw (gross) from the dashboard DTO — netted internally, same convention
   *  as the sibling IncomeCard/OverviewStatStrip. */
  upcoming: AnnouncedDividendDTO[];
  todayISO: string;
  taxRate: number | null;
}) {
  const rows = netAnnouncedDividends(upcoming, netFactor(taxRate)).slice(0, 3);
  const taxed = taxRate != null;
  return (
    <Card>
      <CardTitle meta={rows.length > 0 ? `${rows.length} announced` : undefined}>
        Upcoming
      </CardTitle>
      {rows.length > 0 && (
        <div className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{taxed ? "After tax" : "Before tax"}</span>
          <InfoTooltip label="About this figure">
            Payout amounts are {taxed ? "after" : "before"} your configured dividend tax rate (a
            single flat rate, not per-country withholding).
          </InfoTooltip>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No dividends scheduled.</div>
      ) : (
        rows.map((d) => {
          const date = d.paymentDate ?? d.exDate;
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
