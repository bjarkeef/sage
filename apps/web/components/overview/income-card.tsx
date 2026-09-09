import { BasisChip, Card, CardTitle } from "@sage/ui";
import { formatMoney, moneyToNumber } from "../../lib/format";
import { netFactor } from "../../lib/dividend-tax";
import type { DashboardDTO, MoneyDTO } from "../../lib/types";

function scale(m: MoneyDTO, f: number): MoneyDTO {
  return { amount: (moneyToNumber(m) * f).toFixed(2), currency: m.currency };
}

export function IncomeCard({
  income,
  annualIncome,
  taxRate,
}: {
  income: DashboardDTO["income"]["thisMonth"];
  annualIncome: MoneyDTO | null;
  taxRate: number | null;
}) {
  const f = netFactor(taxRate);
  const taxed = taxRate != null;
  // Headline is this month's FULL income (received + upcoming) so it reconciles
  // with the dividend calendar's current-month total; the received slice drives
  // the progress bar. Both are net when a tax rate is configured.
  const monthTotal = income ? scale(income.projected, f) : null;
  const received = income ? scale(income.received, f) : null;
  const annual = annualIncome ? scale(annualIncome, f) : null;
  const ratio =
    income && moneyToNumber(income.projected) > 0
      ? Math.min(
          100,
          Math.max(0, (moneyToNumber(income.received) / moneyToNumber(income.projected)) * 100),
        )
      : 0;
  return (
    <Card>
      <div className="mb-3.5">
        <CardTitle className="mb-0" meta={<BasisChip taxed={taxed} />}>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-income" />
            Income
          </span>
        </CardTitle>
        <div className="text-xs text-muted-foreground">This month</div>
      </div>
      <div className="stat-num">{monthTotal ? formatMoney(monthTotal) : "—"}</div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-hairline">
        <div className="h-full rounded-full bg-income" style={{ width: `${ratio}%` }} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {received ? `${formatMoney(received)} received so far` : "No income this month"}
        {annual ? ` · ≈ ${formatMoney(annual)} / yr forward` : ""}
      </div>
    </Card>
  );
}
