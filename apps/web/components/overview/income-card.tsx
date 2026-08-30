import { Card, CardTitle, InfoTooltip } from "@sage/ui";
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
      <CardTitle meta="This month">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-income" />
          Income
        </span>
      </CardTitle>
      <div className="stat-num">{monthTotal ? formatMoney(monthTotal) : "—"}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span>{taxed ? "After tax" : "Before tax"}</span>
        <InfoTooltip label="About this figure">
          This month&apos;s full dividend income — received plus upcoming —{" "}
          {taxed ? "after" : "before"} dividend tax
          {taxed ? " (your single configured rate, applied flatly)" : ""}. The bar shows how much
          has been received so far.
        </InfoTooltip>
      </div>
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
