import { Card, Chip, InfoTooltip, SectionHeader, Stat } from "@sage/ui";
import { formatMoney, formatDate } from "../../../../lib/format";
import { netFactor } from "../../../../lib/dividend-tax";
import type { AssetCustomDTO, AssetIncomeDTO } from "../../../../lib/types";

function pct(fraction: number | null): string {
  return fraction != null ? `${(fraction * 100).toFixed(2)}%` : "—";
}

/** "Every month" / "Every 2 months" — matches the cadence phrasing on the
 *  custom-holding form. */
function cadenceLabel(unit: string, interval: number): string {
  if (interval <= 1) return `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
}

export function IncomeSection({
  income,
  custom,
  taxRate,
}: {
  income: AssetIncomeDTO;
  custom?: AssetCustomDTO | null;
  taxRate: number | null;
}) {
  const customIncome = custom?.income ?? null;
  const hasData =
    income.currentYield != null ||
    income.yieldOnCost != null ||
    income.annualDividend != null ||
    income.dividendGrowth5y != null;
  if (!hasData && !customIncome) return null;

  const growth = income.dividendGrowth5y != null ? Number(income.dividendGrowth5y) : null;

  // Yields are rates you'd actually receive, so they net. The per-share
  // dividend below stays gross — it's the issuer's declared figure, which
  // people cross-check against the announcement.
  const f = netFactor(taxRate);
  const taxed = taxRate != null;
  const currentYield = income.currentYield == null ? null : income.currentYield * f;
  const yieldOnCost = income.yieldOnCost == null ? null : income.yieldOnCost * f;

  return (
    <section className="mb-10">
      <SectionHeader title="Income" />
      {customIncome && (
        <Card className="mb-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <Stat size="sm" label="Rate" value={`${customIncome.yearlyPct}%`} />
            <Stat
              size="sm"
              label="Cadence"
              value={cadenceLabel(customIncome.frequencyUnit, customIncome.frequencyInterval)}
            />
            <Stat
              size="sm"
              label="Next payment"
              value={customIncome.nextPaymentDate ? formatDate(customIncome.nextPaymentDate) : "—"}
            />
            <Stat
              size="sm"
              label="Reinvest"
              value={
                <Chip tone={customIncome.reinvest ? "income" : "neutral"}>
                  {customIncome.reinvest ? "Reinvested" : "Paid as cash"}
                </Chip>
              }
            />
          </div>
        </Card>
      )}
      {hasData && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] sm:items-stretch">
          <Card className="flex flex-col">
            <div className="flex items-center gap-1 label-caps text-muted-foreground">
              <span>Current yield</span>
              <InfoTooltip label="About this figure">
                Annual dividends per share ÷ today&apos;s price,{" "}
                {taxed
                  ? "after your configured dividend tax rate (a single flat rate, not per-country withholding). Brokers and quote sites publish this figure before tax, so theirs will read higher."
                  : "before dividend tax. Set a rate in Settings for a net figure."}
              </InfoTooltip>
            </div>
            <div className="hero-num mt-2 text-income">{pct(currentYield)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {taxed ? "After tax" : "Before tax"}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {income.annualDividend
                ? `on today's price, ${formatMoney(income.annualDividend)} / share`
                : "on today's price"}
            </div>
            {yieldOnCost != null && (
              <div className="mt-auto border-t border-hairline-faint pt-4 text-sm text-muted-foreground">
                Yield on cost{" "}
                <span className="font-medium tabular-nums text-foreground">{pct(yieldOnCost)}</span>
              </div>
            )}
          </Card>
          <Card>
            <div className="grid h-full grid-cols-2 gap-x-8 gap-y-8 sm:content-center">
              <Stat
                size="sm"
                label="Next ex-date"
                value={income.nextExDate ? formatDate(income.nextExDate) : "—"}
              />
              <Stat
                size="sm"
                label="5Y growth"
                value={
                  growth != null ? (
                    <span className={growth >= 0 ? "text-gain" : "text-loss"}>
                      {growth >= 0 ? "+" : "−"}
                      {Math.abs(growth * 100).toFixed(1)}%
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <Stat
                size="sm"
                label="Annual / share"
                value={income.annualDividend ? formatMoney(income.annualDividend) : "—"}
              />
              <Stat size="sm" label="Payout ratio" value={pct(income.payoutRatio)} />
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
