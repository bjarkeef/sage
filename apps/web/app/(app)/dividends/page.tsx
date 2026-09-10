// apps/web/app/(app)/dividends/page.tsx
"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  PageShell,
  SegmentedControl,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@sage/ui";
import { AppPageHeader } from "../../../components/app-page-header";
import { getPortfolio, syncDividends } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { invalidateFor } from "../../../lib/query/invalidation";
import { yieldBySymbol } from "../../../lib/dividend-derive";
import { useNetDividendIncome } from "../../../lib/dividend-tax-hooks";
import { YearSummary } from "../../../components/dividend/year-summary";
import {
  yearProgressFromEvents,
  paymentYearBounds,
  monthlyTotalsForYear,
  yearRunsPastForecast,
} from "../../../lib/dividend-year";
import { buildCalendarEvents } from "../../../lib/dividend-events";
import { DividendStatusFilter } from "../../../components/dividend/dividend-status-filter";
import { DividendList } from "../../../components/dividend/dividend-list";
import { DividendIncomeBars } from "../../../components/dividend-income-bars";
import { FxUnavailableCallout } from "../../../components/fx-unavailable-callout";
import { FxStaleCallout } from "../../../components/fx-stale-callout";
import {
  DividendCalendarGrid,
  type CalendarStatus,
} from "../../../components/dividend-calendar-grid";
import { DividendsPageSkeleton } from "../../../components/skeletons";
import { TaxBasisNote } from "../../../components/tax-basis-note";
import { formatDate } from "../../../lib/format";
import Link from "next/link";

const VIEW_OPTIONS = [
  { label: "Calendar", value: "calendar" },
  { label: "List", value: "list" },
];

const ALL_STATUSES: CalendarStatus[] = ["paid", "announced", "projected"];

export default function DividendsPage() {
  const queryClient = useQueryClient();
  const [view, setView] = React.useState("calendar");

  // A month grid is seven columns wide whatever the screen, so on a phone the
  // calendar can only be shown by scrolling it sideways — the default view
  // would be something you drag to read. The list says the same thing in one
  // column, so that is what a phone opens on. Only the initial view: the
  // toggle still works, and choosing the calendar there is then deliberate.
  const pickedView = React.useRef(false);
  React.useEffect(() => {
    if (pickedView.current) return;
    pickedView.current = true;
    if (window.matchMedia("(max-width: 767px)").matches) setView("list");
  }, []);
  const [calendarDate, setCalendarDate] = React.useState<Date>(() => new Date());
  const [syncing, setSyncing] = React.useState(false);
  const [activeStatuses, setActiveStatuses] = React.useState<Set<CalendarStatus>>(
    () => new Set(ALL_STATUSES),
  );

  // After-tax by default: `useNetDividendIncome` scales every income figure by
  // the net factor once, so the whole page (summary, chart, calendar amounts,
  // list) renders after-tax from a single shared transform. No rate → factor 1
  // → unchanged gross. `amountPerShare` stays gross (declared). `gross` (the
  // pre-transform payload) is what the yield calculations below need, since
  // they divide by an untaxed market value and then scale by `factor` once.
  const { data, gross: income, isLoading: incomeLoading, factor } = useNetDividendIncome();
  const {
    data: portfolio,
    isLoading: portfolioLoading,
    refetch: refetchPortfolio,
  } = useQuery({ queryKey: qk.portfolio(), queryFn: () => getPortfolio() });

  const loading = incomeLoading || portfolioLoading;

  async function handleSync() {
    setSyncing(true);
    try {
      await syncDividends();
      await invalidateFor(queryClient, "dividend-sync");
      void refetchPortfolio();
    } catch {
      // sync failed silently
    } finally {
      setSyncing(false);
    }
  }

  function toggleStatus(status: CalendarStatus) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const selectedMonth = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}`;

  // The page-level year picker's own source of truth: every event, and the
  // span of years they cover. `calendarDate` carries the picked year AND the
  // grid's month — there is deliberately no second `selectedYear` state to
  // fall out of sync with it.
  const events = React.useMemo(
    () =>
      data
        ? [
            ...buildCalendarEvents(
              data.retroactive,
              data.announced,
              data.projected,
              todayIso,
            ).values(),
          ].flat()
        : [],
    [data, todayIso],
  );
  const bounds = React.useMemo(
    () => paymentYearBounds(events, now),
    // `now` is a new object each render; depend on its year, not the object
    // itself, or this recomputes on every render (same rationale as
    // `progress` below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, now.getFullYear()],
  );
  const yearOptions = React.useMemo(
    () => Array.from({ length: bounds.last - bounds.first + 1 }, (_, i) => bounds.first + i),
    [bounds],
  );
  const selectedYear = calendarDate.getFullYear();

  // The year picker offers next year in full while projections stop one year
  // from today, so picking next year renders its later months as an empty
  // calendar — which reads as "this portfolio earns nothing then", the opposite
  // of what is true. Predicate and date both come from shared code so the note
  // can never name a date the projection did not honour.
  const horizonIso = data?.projectedThrough;
  const yearRunsPastHorizon = yearRunsPastForecast(selectedYear, now, horizonIso);

  const yieldMap = React.useMemo(() => {
    if (!income || !portfolio) return undefined;
    const gross = yieldBySymbol(income.perHolding, portfolio.positions);
    if (factor === 1) return gross;
    return new Map([...gross].map(([sym, y]) => [sym, y * factor]));
  }, [income, portfolio, factor]);
  // The summary band reads the SAME events the bars, the grid and the list do,
  // through the SAME filter. Derived from `monthlyBreakdown` it was a different
  // population — the API drops FX-unconvertible rows from that payload and the
  // status filter cannot reach it — so the hero and the list's subtotals
  // disagreed as soon as anyone deselected a status.
  const progress = React.useMemo(
    () => yearProgressFromEvents(events, selectedYear, activeStatuses),
    [events, selectedYear, activeStatuses],
  );
  // Filtered by activeStatuses, exactly as the bar's dollar total now is: a
  // tooltip must describe the bar it is attached to, and the two figures in it
  // must move together. Before the chart answered the filter, filtering only
  // the payer count would have read "0 payers" beside a full dollar total.
  const payersByMonth = React.useMemo(
    () =>
      new Map(
        monthlyTotalsForYear(events, selectedYear, activeStatuses).map((m) => [
          `${selectedYear}-${String(m.month).padStart(2, "0")}`,
          m.payers,
        ]),
      ),
    [events, selectedYear, activeStatuses],
  );
  // The chart's own empty state, scoped to the year its copy names. Guarded on
  // the whole payload it rendered twelve zero bars for an empty year whenever
  // any OTHER year had income.
  const yearHasBreakdown = React.useMemo(
    () =>
      (data?.summary.monthlyBreakdown ?? []).some((m) => m.month.startsWith(`${selectedYear}-`)),
    [data?.summary.monthlyBreakdown, selectedYear],
  );

  if (loading && !data) {
    return (
      <PageShell animate={false}>
        <DividendsPageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AppPageHeader
        title="Dividends"
        description={incomeLoading ? null : <TaxBasisNote rate={income?.dividendTaxRate ?? null} />}
        actions={
          <>
            <select
              aria-label="Year"
              value={selectedYear}
              onChange={(e) =>
                setCalendarDate((d) => new Date(Number(e.target.value), d.getMonth(), 1))
              }
              className="h-8 rounded-control border border-border bg-transparent px-2 text-sm"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} size="sm" />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="More actions">
                  ⋯
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2">
                <button
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={syncing}
                  className="w-full rounded-control px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                >
                  {syncing ? "Syncing…" : "Re-sync dividends"}
                </button>
              </PopoverContent>
            </Popover>
          </>
        }
      />

      {!loading && data?.fxIncomplete && <FxUnavailableCallout className="mb-4" />}
      {!loading && data?.fxStale && <FxStaleCallout asOf={data?.fxRatesAsOf} className="mb-4" />}

      {data && (
        <>
          {/* Progress + chart band: a narrow details card beside a flexible
              month-picker card, same split as the asset page's yield card
              beside its chart. */}
          <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-stretch">
            <YearSummary progress={progress} year={selectedYear} />
            <Card compact>
              {yearHasBreakdown ? (
                <DividendIncomeBars
                  data={data.summary.monthlyBreakdown}
                  year={selectedYear}
                  currentMonth={currentMonth}
                  selectedMonth={selectedMonth}
                  payersByMonth={payersByMonth}
                  activeStatuses={activeStatuses}
                  onMonthSelect={(month) => {
                    const [yy, mm] = month.split("-").map(Number);
                    setCalendarDate(new Date(yy ?? now.getFullYear(), (mm ?? 1) - 1, 1));
                    setView("calendar");
                  }}
                />
              ) : (
                <div className="grid h-40 place-items-center text-sm text-muted-foreground">
                  No income recorded for {selectedYear}.
                </div>
              )}
            </Card>
          </section>

          {/* Directly under the monthly bars rather than at the foot of the
              page: the empty months are visible *here*, and a calendar grid's
              worth of scrolling between the gap and its explanation is the same
              as having no explanation. */}
          {yearRunsPastHorizon && (
            <p className="-mt-6 mb-8 text-xs text-muted-foreground">
              Payments are only forecast to {formatDate(horizonIso!, { year: "always" })}. Later
              months in {selectedYear} are empty because the forecast ends there, not because
              nothing is expected — for a longer horizon see{" "}
              <Link
                href="/goal"
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                your goal
              </Link>
              , which projects income across scenarios.
            </p>
          )}

          <div className="mb-4">
            <DividendStatusFilter active={activeStatuses} onToggle={toggleStatus} />
          </div>

          {view === "calendar" && (
            <section>
              <Card compact>
                <DividendCalendarGrid
                  events={events}
                  bounds={bounds}
                  viewDate={calendarDate}
                  onViewDateChange={setCalendarDate}
                  activeStatuses={activeStatuses}
                  yieldBySymbol={yieldMap}
                />
              </Card>
            </section>
          )}

          {view === "list" && (
            <section>
              <DividendList events={events} year={selectedYear} statuses={activeStatuses} />
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
