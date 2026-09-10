import { Delta } from "@sage/ui";
import { formatDate, formatMoney, moneyToNumber } from "../../lib/format";
import type { DashboardDTO, MoneyDTO, PortfolioHistoryPoint } from "../../lib/types";

export function OverviewHero({
  value,
  todayChange,
  scrubbed,
}: {
  value: MoneyDTO | null;
  todayChange: DashboardDTO["todayChange"];
  /** The day under the pointer on the chart below, when there is one. The
   *  numeral and the chart are one instrument: dragging the chart rewrites this
   *  figure, rather than leaving the reader to match a tooltip against a total
   *  that never moves. */
  scrubbed?: PortfolioHistoryPoint | null;
}) {
  const shown = scrubbed?.value ?? value;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="hero-num">{shown ? formatMoney(shown) : "—"}</span>
      {scrubbed ? (
        // The day replaces the delta rather than joining it: "today" is a claim
        // about now, and while the pointer is on March it would be false.
        <span className="text-xs text-muted-foreground">
          {formatDate(scrubbed.date, { year: "always" })}
        </span>
      ) : (
        todayChange && (
          <>
            <Delta
              value={moneyToNumber(todayChange.amount)}
              percent={todayChange.percent}
              currency={todayChange.amount.currency}
            />
            <span className="text-xs text-muted-foreground">today</span>
          </>
        )
      )}
    </div>
  );
}
