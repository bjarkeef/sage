import { BasisChip, Card, CardTitle } from "@sage/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { netAnnouncedDividends, netFactor } from "../../lib/dividend-tax";
import { CERTAINTY_FILL } from "../charts/certainty-bars";
import type { UpcomingRow } from "../../lib/types";

/** Matches `selectUpcoming`'s own cap (`apps/api/src/routes/dashboard.ts`) —
 *  the API already trims to this many, but the card keeps its own cap too so
 *  it never silently grows if that changes, and so "visible rows" (below) has
 *  a well-defined meaning independent of the API. */
const MAX_VISIBLE_ROWS = 5;

const DAY_MS = 86_400_000;

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / DAY_MS);
}

/** `selectUpcoming` deliberately reaches past its 30-day window when fewer
 *  than `MIN_ROWS` payments fall inside it (`apps/api/src/routes/dashboard.ts`),
 *  rather than rendering a couple of rows beside a full Portfolio card. A
 *  fixed "next 30 days" caption would then lie about a row 45+ days out, so
 *  this derives the caption from what's actually rendered: the normal
 *  30-day frame when every visible row fits inside it, or the true span out
 *  to the furthest visible date otherwise. Exported for direct unit
 *  testing. */
export function upcomingWindowLabel(rows: UpcomingRow[], todayISO: string): string {
  if (rows.length === 0) return "next 30 days";
  const furthest = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0]!.date);
  return `next ${Math.max(daysBetween(todayISO, furthest), 30)} days`;
}

export function UpcomingCard({
  upcoming,
  todayISO,
  taxRate,
}: {
  /** Raw (gross) from the dashboard DTO — netted internally, same convention
   *  as the sibling IncomeCard/OverviewStatStrip. Mixes announced and
   *  projected payments (`dashboard.ts`'s `selectUpcoming`, Task 10); this
   *  component renders both honestly rather than presenting the whole card
   *  as "announced". */
  upcoming: UpcomingRow[];
  todayISO: string;
  taxRate: number | null;
}) {
  const rows = netAnnouncedDividends(upcoming, netFactor(taxRate)).slice(0, MAX_VISIBLE_ROWS);
  const taxed = taxRate != null;
  // Only a row actually on screen can justify the legend explaining its
  // mark — a `dateEstimated` row the cap above cut still lives in `upcoming`
  // but must not be counted here.
  const showEstimatedLegend = rows.some((r) => r.dateEstimated);
  return (
    <Card>
      <div className="mb-3">
        <CardTitle
          className="mb-0"
          meta={rows.length > 0 ? <BasisChip taxed={taxed} /> : undefined}
        >
          Upcoming
        </CardTitle>
        {rows.length > 0 && (
          <div className="text-xs text-muted-foreground">{upcomingWindowLabel(rows, todayISO)}</div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No dividends scheduled.</div>
      ) : (
        <>
          <div role="list">
            {rows.map((d) => {
              const date = d.date;
              const isToday = date === todayISO;
              return (
                <div
                  key={`${d.symbol}-${date}`}
                  role="listitem"
                  className="flex items-baseline justify-between gap-3 border-b border-hairline-faint py-2 text-sm last:border-b-0"
                >
                  <span className="label-caps text-muted-foreground">
                    {d.dateEstimated && (
                      <span
                        data-testid="date-estimated-mark"
                        style={{ color: CERTAINTY_FILL.estimated }}
                      >
                        ~{" "}
                      </span>
                    )}
                    {formatDate(date)}
                  </span>
                  <span className="flex-1 truncate font-medium">{d.symbol}</span>
                  <span
                    className={`font-mono text-xs tabular-nums ${isToday ? "text-income" : "text-muted-foreground"}`}
                  >
                    {d.projected && <span data-testid="amount-projected-mark">≈ </span>}
                    {formatMoney({ amount: d.income, currency: d.currency })}
                  </span>
                </div>
              );
            })}
          </div>
          {showEstimatedLegend && (
            <div className="mt-3 text-xs text-muted-foreground">
              <span className="font-mono">~ estimated date</span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
