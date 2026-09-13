import { Delta } from "@sage/ui";
import { formatDate, moneyToNumber } from "../../lib/format";
import type { DashboardDTO, MoneyDTO, PortfolioHistoryPoint } from "../../lib/types";

/**
 * The figure, with the parts that are not the figure stepped down.
 *
 * At 108px a currency code set solid takes a third of the line and the øre
 * shout as loudly as the thousands. Both are still printed — the hero and the
 * Portfolio card below agree to the øre and that was hard-won, so rounding the
 * headline for looks is not a trade available here. They are just no longer
 * competing with the digits that carry the meaning.
 */
function HorizonMoney({ money }: { money: MoneyDTO }) {
  const parts = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(Number(money.amount));
  return (
    <span className="horizon-num">
      {parts.map((part, i) =>
        part.type === "currency" ? (
          <span key={i} className="pr-1 align-baseline text-2xl font-light text-muted-foreground">
            {part.value}
          </span>
        ) : part.type === "decimal" || part.type === "fraction" ? (
          <span key={i} className="text-muted-foreground/70">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}

export function OverviewHero({
  value,
  todayChange,
  scrubbed,
  brief,
}: {
  value: MoneyDTO | null;
  todayChange: DashboardDTO["todayChange"];
  /** The day under the pointer on the chart below, when there is one. The
   *  numeral and the chart are one instrument: dragging the chart rewrites this
   *  figure, rather than leaving the reader to match a tooltip against a total
   *  that never moves. */
  scrubbed?: PortfolioHistoryPoint | null;
  /** The greeting and the day's line, rendered beneath the figure.
   *
   *  Beneath rather than above: a greeting set large enough to lead the page
   *  competes with the figure for the same job, and the figure should win. At
   *  this size it reads as the app speaking after it has shown you the number,
   *  which is the right order. */
  brief?: React.ReactNode;
}) {
  const shown = scrubbed?.value ?? value;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {shown ? <HorizonMoney money={shown} /> : <span className="horizon-num">—</span>}
        {scrubbed ? (
          // The day replaces the delta rather than joining it: "today" is a claim
          // about now, and while the pointer is on March it would be false.
          <span className="font-mono text-xs tracking-wide text-muted-foreground">
            {formatDate(scrubbed.date, { year: "always" })}
          </span>
        ) : (
          todayChange && (
            <span className="flex items-center gap-1.5 pb-1">
              <Delta
                value={moneyToNumber(todayChange.amount)}
                percent={todayChange.percent}
                currency={todayChange.amount.currency}
              />
              <span className="text-xs text-muted-foreground">today</span>
            </span>
          )
        )}
      </div>
      {brief}
    </div>
  );
}
