"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getGoal } from "../../lib/api";
import { qk } from "../../lib/query/keys";
import { formatMoney } from "../../lib/format";
import { Skeleton } from "@sage/ui";

/**
 * What the book is actually for, on the page you land on.
 *
 * A dividend account is not run for its net worth, and until now nothing on the
 * overview said so — the goal lived on its own page and the front page opened
 * with a number that is not the point. This is one line and one track: how far
 * the income has come, and the year it is aimed at.
 *
 * Deliberately not a card. It sits under the ledger on the same bare ground,
 * because it finishes the same sentence.
 */
export function GoalBand() {
  const { data, isPending } = useQuery({
    queryKey: qk.goal(),
    queryFn: getGoal,
    staleTime: 300_000,
  });

  const goal = data?.goal ?? null;
  const result = data?.result ?? null;

  // In flight. Two things go wrong without this branch, and the second is the
  // worse one: the band occupies no height until the query lands and then
  // pushes the whole page down, AND `!goal` is indistinguishable from "no goal
  // set", so a reader who HAS a goal was told to go and set one for as long as
  // the request took.
  //
  // Same height as both real states, so nothing moves whichever one arrives.
  if (isPending) {
    return (
      <div
        role="status"
        aria-label="Loading goal progress"
        className="flex flex-col gap-3 border-t border-hairline-faint pt-5"
      >
        <Skeleton className="h-5 w-[min(440px,70%)]" />
        <Skeleton className="h-[3px] w-full rounded-full" />
      </div>
    );
  }

  // No goal set, or not enough history to project one. An empty track reads as
  // a failure state; an invitation reads as the next thing to do. This is the
  // first-run case the mockup flagged, and it is why the band cannot simply
  // render a zeroed bar.
  if (!goal || !result) {
    return (
      <div className="flex min-h-[42px] flex-col justify-center border-t border-hairline-faint pt-5">
        <p className="text-sm text-muted-foreground">
          <Link href="/goal" className="text-foreground hover:underline">
            Set a goal
          </Link>{" "}
          and this page will show how close the income is to it.
        </p>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, result.progressPct));
  const current = { amount: result.currentMetric, currency: result.currency };
  // `goalAtTargetYear` is the goal inflated to the target year — the figure
  // `progressPct` is actually measured against. Printing the nominal goal
  // beside a percentage computed from the inflated one is how a reader ends up
  // dividing two numbers on screen and getting a third answer.
  const target = { amount: result.goalAtTargetYear, currency: result.currency };

  return (
    <div className="flex flex-col gap-3 border-t border-hairline-faint pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          Living on it by <span className="font-medium">{result.targetYear}</span> —{" "}
          <span className="tabular-nums">{formatMoney(current)}</span> a year so far, of{" "}
          <span className="tabular-nums">{formatMoney(target)}</span>
          {result.netMode ? " after tax" : ""}.
        </p>
        <span className="label-caps tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
      </div>
      <div
        className="h-[3px] w-full overflow-hidden rounded-full bg-hairline"
        role="img"
        aria-label={`${pct.toFixed(1)} percent of the ${result.targetYear} income goal`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
