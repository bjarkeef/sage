import type { ReactNode } from "react";
import { cn } from "@sage/ui";
import { formatDate } from "../../../../lib/format";
import { staleAsOf, type Flag } from "../../../../lib/asset-page/reliability";
import { CheckMark, StaleNote } from "./reliability-marks";

export interface Fact {
  label: string;
  value: ReactNode;
  flag?: Flag | null;
  /** When the provider produced it; drives the hover and the inline stale note. */
  asOf: string | null;
  /** Prose rather than a figure (a name, a link): sans instead of mono. */
  text?: boolean;
}

/** One provider fact: label left, value right, its date on hover — "as of"
 *  inline once older than 7 days — and a check marker when implausible. */
export function FactRow({ fact, todayISO }: { fact: Fact; todayISO: string }) {
  const dated = fact.asOf
    ? `Provider figure, as of ${formatDate(fact.asOf.slice(0, 10), { year: "always" })}`
    : "Provider figure";
  return (
    <div
      title={dated}
      className="flex items-baseline justify-between gap-4 border-b border-hairline-faint py-2.5 last:border-0"
    >
      <dt className="shrink-0 text-sm text-muted-foreground">{fact.label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right",
          fact.text ? "text-sm" : "font-mono text-data tabular-nums",
        )}
      >
        {fact.value}
        {fact.flag && <CheckMark flag={fact.flag} />}
        <StaleNote note={staleAsOf(fact.asOf, todayISO)} />
      </dd>
    </div>
  );
}
