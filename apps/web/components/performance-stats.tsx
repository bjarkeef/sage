/** Formats a decimal rate (0.1432) as a signed percentage string ("+14.3%").
 *  `sign: false` suppresses the leading "+" for values that are never a gain/loss
 *  (e.g. volatility). `null` renders as an em dash. */
export function formatRate(value: number | null, opts?: { sign?: boolean }): string {
  if (value === null) return "—";
  const pct = (value * 100).toFixed(1);
  const signed = opts?.sign !== false && value > 0 ? `+${pct}` : pct;
  return `${signed}%`;
}

/** Centered "not enough history yet" block, shown by the page when
 *  `insufficientData` is true. Extracted here (rather than inlined in the
 *  page) so it's covered by this file's test suite. */
export function PerformanceEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="label-caps inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-muted-foreground">
        Not enough history
      </span>
      <p className="max-w-md text-sm text-muted-foreground">
        Performance needs at least two days of price history. Add transactions or check back
        tomorrow.
      </p>
    </div>
  );
}
