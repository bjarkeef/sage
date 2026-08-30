"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, ChartSkeleton, EmptyState, PageShell } from "@sage/ui";
import { getGoal, putGoal, deleteGoal } from "../../../lib/api";
import type { PutGoalInput } from "../../../lib/types";
import { qk } from "../../../lib/query/keys";
import { GoalForm } from "../../../components/goal/goal-form";
import { GoalProgressHero } from "../../../components/goal/goal-progress-hero";
import { GoalCallouts } from "../../../components/goal/goal-callouts";
import { GoalResultsTable } from "../../../components/goal/goal-results-table";
import { GoalPageSkeleton } from "../../../components/skeletons";
import { AppPageHeader } from "../../../components/app-page-header";

const GoalProjectionChart = dynamic(
  () => import("../../../components/goal/goal-projection-chart").then((m) => m.GoalProjectionChart),
  { ssr: false, loading: () => <ChartSkeleton className="h-64" /> },
);

export default function GoalPage() {
  const queryClient = useQueryClient();
  const { data: view, isLoading } = useQuery({ queryKey: qk.goal(), queryFn: getGoal });

  const save = useMutation({
    mutationFn: (input: PutGoalInput) => putGoal(input),
    onSuccess: (fresh) => queryClient.setQueryData(qk.goal(), fresh),
  });
  const remove = useMutation({
    mutationFn: deleteGoal,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.goal() }),
  });

  if (isLoading) {
    return (
      <PageShell>
        <GoalPageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AppPageHeader
        title="Goal"
        description="Your path to financial independence — set a target, see when you get there."
      />

      {/* An empty portfolio and a multi-currency one both land here with no
          defaults, and they need opposite advice. This branch used to print the
          API's `reason` verbatim — a lowercase sentence fragment — under an
          "Open Settings" button, which is the fix for the currency case offered
          to someone whose problem is that they have no holdings. */}
      {view && !view.defaults && view.reasonCode === "no_positions" && (
        <EmptyState
          message="A goal projects from what you already hold, so there is nothing to project from yet. Add a holding or import your transactions and this page will fill in."
          action={
            <Link href="/import" className="text-sm text-primary hover:underline">
              Import transactions →
            </Link>
          }
        />
      )}

      {view && !view.defaults && view.reasonCode !== "no_positions" && (
        <p className="text-sm text-muted-foreground">
          {view.reason ?? "Cannot compute a goal for this portfolio."}{" "}
          <Link href="/settings" className="underline decoration-dotted underline-offset-2">
            Open Settings
          </Link>
        </p>
      )}

      {view?.defaults && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4">
            <GoalForm
              goal={view.goal}
              defaults={view.defaults}
              saving={save.isPending}
              onSave={(input) => save.mutate(input)}
              onDelete={() => remove.mutate()}
            />
          </div>
          <div className="col-span-12 md:col-span-8">
            {view.result && view.goal ? (
              <Card compact className="flex flex-col gap-5">
                <GoalProgressHero result={view.result} mode={view.goal.type} />
                <GoalProjectionChart
                  scenarios={view.result.scenarios}
                  mode={view.goal.type}
                  targetYear={view.result.targetYear}
                  currency={view.result.currency}
                />
                <GoalCallouts result={view.result} />
                <GoalResultsTable result={view.result} mode={view.goal.type} />
                {/* Not a legal notice — the same habit as flagging short price
                    history or stale FX, applied to the one page that draws the
                    future instead of reporting the past. It says how to read
                    the curve, which is why it sits here and not in the README. */}
                <p className="border-t border-hairline pt-4 text-xs text-muted-foreground">
                  A projection, not a forecast: this compounds the assumptions above and guarantees
                  nothing.
                </p>
              </Card>
            ) : (
              <div className="flex h-full min-h-[280px] items-center justify-center rounded-card border border-dashed border-border text-sm text-muted-foreground">
                {view.reason ?? "Set a goal to see your path"}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
