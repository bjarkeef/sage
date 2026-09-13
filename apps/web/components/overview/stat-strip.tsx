import { Stat, StatStrip } from "@sage/ui";
import { formatMoney, moneyToNumber } from "../../lib/format";
import { netFactor } from "../../lib/dividend-tax";
import type { DashboardDTO, MoneyDTO } from "../../lib/types";

function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

function scale(m: MoneyDTO, f: number): MoneyDTO {
  return { amount: (moneyToNumber(m) * f).toFixed(2), currency: m.currency };
}

export function OverviewStatStrip({
  ytdPercent,
  income,
  annualIncome,
  totalReturn,
  taxRate,
}: {
  ytdPercent: number | null;
  income: DashboardDTO["income"]["thisMonth"];
  annualIncome: MoneyDTO | null;
  totalReturn: DashboardDTO["totalReturn"];
  taxRate: number | null;
}) {
  const f = netFactor(taxRate);
  const ytdTone = ytdPercent == null ? "" : ytdPercent >= 0 ? "text-gain" : "text-loss";
  const trTone =
    totalReturn == null
      ? ""
      : totalReturn.amount.amount.startsWith("-")
        ? "text-loss"
        : "text-gain";
  // Headline this month's FULL total, matching the Income card below — the
  // strip used to show received-so-far, so the same month read two ways on one
  // screen. Received is demoted to the context line.
  const monthTotal = income ? scale(income.projected, f) : null;
  const received = income ? scale(income.received, f) : null;
  const annual = annualIncome ? scale(annualIncome, f) : null;
  return (
    <StatStrip className="mt-6">
      <Stat
        size="sm"
        label="YTD return"
        value={<span className={ytdTone}>{pct(ytdPercent)}</span>}
        context="time-weighted"
      />
      <Stat
        size="sm"
        label="Income this month"
        value={monthTotal ? formatMoney(monthTotal) : "—"}
        context={received ? `${formatMoney(received)} received so far` : undefined}
      />
      <Stat
        size="sm"
        label="Annual income"
        value={annual ? `≈ ${formatMoney(annual)}` : "—"}
        context="forward"
      />
      <Stat
        size="sm"
        label="Made since you started"
        value={
          totalReturn ? (
            <span className={trTone}>
              {totalReturn.amount.amount.startsWith("-") ? "" : "+"}
              {formatMoney(totalReturn.amount).replace(/^-/, "−")}
            </span>
          ) : (
            "—"
          )
        }
        context="held, sold and paid out"
      />
    </StatStrip>
  );
}
