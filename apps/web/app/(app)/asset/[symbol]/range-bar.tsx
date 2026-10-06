import type { ReactNode } from "react";
import type { Flag } from "../../../../lib/asset-page/reliability";
import { CheckMark } from "./reliability-marks";

/** A low–high track with today's marker and all three values printed — the
 *  numbers are the point; the bar only places them. */
export function RangeBar({
  label,
  low,
  high,
  current,
  format,
  context,
  flag,
  title,
}: {
  label: string;
  low: number;
  high: number;
  current: number;
  format: (v: number) => string;
  context?: ReactNode;
  flag?: Flag | null;
  title?: string;
}) {
  const span = high - low;
  const pos = span > 0 ? Math.min(100, Math.max(0, ((current - low) / span) * 100)) : 50;
  return (
    <div title={title}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {label}
          {flag && <CheckMark flag={flag} />}
        </span>
        {context != null && <span className="text-xs text-muted-foreground">{context}</span>}
      </div>
      <div
        role="img"
        aria-label={`${label}: low ${format(low)}, today ${format(current)}, high ${format(high)}`}
        className="relative mt-3 h-1.5 rounded-full bg-hairline"
      >
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{`Low ${format(low)}`}</span>
        <span className="text-center text-foreground">{`Today ${format(current)}`}</span>
        <span className="text-right">{`High ${format(high)}`}</span>
      </div>
    </div>
  );
}
