import { Delta } from "@sage/ui";
import { formatMoney, moneyToNumber } from "../../lib/format";
import type { DashboardDTO, MoneyDTO } from "../../lib/types";

export function OverviewHero({
  value,
  todayChange,
}: {
  value: MoneyDTO | null;
  todayChange: DashboardDTO["todayChange"];
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="hero-num">{value ? formatMoney(value) : "—"}</span>
      {todayChange && (
        <Delta
          value={moneyToNumber(todayChange.amount)}
          percent={todayChange.percent}
          currency={todayChange.amount.currency}
        />
      )}
      {todayChange && <span className="text-xs text-muted-foreground">today</span>}
    </div>
  );
}
