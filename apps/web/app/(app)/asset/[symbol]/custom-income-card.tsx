import { Card, Chip, Stat } from "@sage/ui";
import { formatDate } from "../../../../lib/format";
import type { AssetCustomIncomeDTO } from "../../../../lib/types";

/** "Every month" / "Every 2 months" — matches the cadence phrasing on the
 *  custom-holding form. */
function cadenceLabel(unit: string, interval: number): string {
  if (interval <= 1) return `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
}

/** A custom holding's contractual income settings — its existing rendering,
 *  unchanged by the redesign apart from dates carrying their year. */
export function CustomIncomeCard({ income }: { income: AssetCustomIncomeDTO }) {
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <Stat size="sm" label="Rate" value={`${income.yearlyPct}%`} />
        <Stat
          size="sm"
          label="Cadence"
          value={cadenceLabel(income.frequencyUnit, income.frequencyInterval)}
        />
        <Stat
          size="sm"
          label="Next payment"
          value={
            income.nextPaymentDate ? formatDate(income.nextPaymentDate, { year: "always" }) : "—"
          }
        />
        <Stat
          size="sm"
          label="Reinvest"
          value={
            <Chip tone={income.reinvest ? "income" : "neutral"}>
              {income.reinvest ? "Reinvested" : "Paid as cash"}
            </Chip>
          }
        />
      </div>
    </Card>
  );
}
