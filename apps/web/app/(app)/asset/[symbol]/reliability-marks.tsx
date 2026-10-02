import type { Flag } from "../../../../lib/asset-page/reliability";

/** A figure Sage cannot compute: "—", with the reason on hover and for screen
 *  readers. Never a zero — `0` is a different claim from "we don't know". */
export function Missing({ reason }: { reason: string }) {
  return (
    <span title={reason} aria-label={`Not available: ${reason}`} className="text-muted-foreground">
      —
    </span>
  );
}

/** A figure shown but not trusted: a muted "check" whose hover says why. Used
 *  for the plausibility flags and for a failed consistency check. Focusable, so
 *  the reason is reachable without a pointer. */
export function CheckMark({ flag }: { flag: Flag }) {
  return (
    <span
      role="note"
      tabIndex={0}
      title={flag.reason}
      aria-label={`Check: ${flag.reason}`}
      className="ml-1.5 cursor-help rounded-badge align-middle font-sans text-xs font-normal text-muted-foreground underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      check
    </span>
  );
}

/** "as of <date>" beside a provider figure more than 7 days old. */
export function StaleNote({ note }: { note: string | null }) {
  if (!note) return null;
  return <span className="ml-1.5 text-xs text-muted-foreground">{note}</span>;
}
