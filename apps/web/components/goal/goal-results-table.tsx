"use client";

import { DataRow, RowCell, RowGrid, RowHeader } from "@sage/ui";
import type { GoalResultDTO, GoalYearRowDTO } from "../../lib/types";
import { formatMoney } from "../../lib/format";

/** Year-by-year forecast: goal, contributions, and each scenario's metric. */
export function GoalResultsTable({
  result,
  mode,
}: {
  result: GoalResultDTO;
  mode: "passive_income" | "value";
}) {
  const portfolio = result.scenarios.find((s) => s.id === "portfolio")!;
  const alternative = result.scenarios.find((s) => s.id === "alternative");
  const metric = (r: { income: string; value: string }) => (mode === "value" ? r.value : r.income);
  const altByOffset = new Map((alternative?.rows ?? []).map((r) => [r.yearOffset, r]));
  const money = (amount: string) => formatMoney({ amount, currency: result.currency });

  // Each row's metric as a share of that row's goal -- the gain that motivates
  // moving off the flat table, which had nowhere to put this. `null` when the
  // goal is zero (avoids a divide-by-zero reading as "0%").
  const shareOfGoal = (r: GoalYearRowDTO): number | null => {
    const goalNum = Number(r.goal);
    if (!goalNum) return null;
    return (Number(metric(r)) / goalNum) * 100;
  };

  const headerCells = alternative
    ? ["Year", "Goal", "Portfolio", "Alternative"]
    : ["Year", "Goal", "Portfolio"];
  // `max-content` rather than fixed pixels. The old 110/140/120 were sized
  // against a book in the tens of thousands; a goal projection runs to the
  // year it is aimed at, so by construction its last rows are the largest
  // numbers in the app. On this book "DKK 2,448,954.74" needed 125px in a
  // 120px column and rendered clipped. No pixel guess survives a long currency
  // code, a bigger book or a JPY ledger — sizing to the content does. The
  // label column stays `1fr` and the wrapper is already `overflow-x-auto`, so
  // an extreme value scrolls rather than clipping.
  const columns = alternative
    ? "minmax(0,1fr) max-content max-content max-content"
    : "minmax(0,1fr) max-content max-content";

  return (
    <div>
      <h3 className="text-sm font-medium">Results table</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Forecasts are approximate; future rows are measured from today&apos;s date
        {mode === "passive_income"
          ? result.netMode
            ? ", with income after tax"
            : ", with income before tax"
          : ""}
        .
      </p>
      {/* `min-w-0` here is load-bearing, not defensive tidying: this div is a
          flex item of the parent Card's flex-col, whose default
          `min-width: auto` refuses to shrink below the row grid's content
          width. Without it the overflow-x-auto below never engages and the
          card pushes `main` sideways instead -- /categories shipped exactly
          this bug. */}
      <div className="mt-3 min-w-0 overflow-x-auto">
        <RowGrid columns={columns}>
          <RowHeader cells={headerCells} />
          {portfolio.rows.map((r) => {
            const alt = altByOffset.get(r.yearOffset);
            const isPortfolioHit = portfolio.achievedInYears === r.yearOffset;
            const isAltHit = alternative?.achievedInYears === r.yearOffset;
            const share = shareOfGoal(r);
            return (
              <DataRow key={r.yearOffset}>
                <RowCell variant="text" primary={r.yearOffset === 0 ? "today" : String(r.year)} />
                <RowCell
                  align="right"
                  primary={money(r.goal)}
                  secondary={
                    <>
                      {money(r.annualContribution)} <span>/yr</span>
                    </>
                  }
                />
                <RowCell
                  align="right"
                  primary={
                    <>
                      {money(metric(r))}
                      {isPortfolioHit && " 🎉"}
                    </>
                  }
                  secondary={
                    <span data-testid={`goal-share-${r.year}`}>
                      {share != null ? `${share.toFixed(1)}% of goal` : "—"}
                    </span>
                  }
                />
                {alternative && (
                  <RowCell
                    align="right"
                    primary={
                      <>
                        {alt ? money(metric(alt)) : "—"}
                        {isAltHit && " 🎉"}
                      </>
                    }
                  />
                )}
              </DataRow>
            );
          })}
        </RowGrid>
      </div>
    </div>
  );
}
