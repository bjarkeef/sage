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
  EmptyState,
  buttonVariants,
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
  breakdownFromEvents,
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
              data.longRange ?? [],
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

  // Past the 12-month forecast the amounts rest on an assumption, not on
  // announcements or recent payments, so a year containing any says so, naming
  // the date the assumption starts rather than a date the web app invented.
  const firstLongRange = React.useMemo(
    () =>
      events
        .filter((e) => e.longRange)
        .map((e) => e.date)
        .sort()[0] ?? null,
    [events],
  );
  const yearHasLongRange = events.some((e) => e.longRange && e.date.startsWith(`${selectedYear}-`));

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
  // The bars read the same events as the hero, grid and list. The server's
  // `monthlyBreakdown` covers only the 12-month forecast and drops rows FX
  // could not convert, so bars drawn from it went empty under a long-range
  // year and disagreed with the hero when FX was incomplete.
  const breakdown = React.useMemo(
    () => breakdownFromEvents(events, selectedYear),
    [events, selectedYear],
  );
  // The chart's own empty state, scoped to the year its copy names.
  const yearHasBreakdown = breakdown.length > 0;

  if (loading && !data) {
    return (
      <PageShell animate={false}>
        <DividendsPageSkeleton />
      </PageShell>
    );
  }

  // Nothing held and nothing ever paid: the year picker, the three dashes and
  // a month grid of empty cells describe a calendar rather than this book, so
  // the page says what would fill it instead of drawing the furniture.
  if (portfolio && portfolio.positions.length === 0 && events.length === 0) {
    return (
      <PageShell>
        <AppPageHeader title="Dividends" description={null} />
        <EmptyState
          message="No dividends yet. Import your transactions and Sage fills this calendar from each holding's payment history — what has been paid, what is confirmed, and what is still an estimate."
          action={
            <Link href="/import" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Import transactions →
            </Link>
          }
        />
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
                  data={breakdown}
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

          {/* Directly under the bars it qualifies, not at the foot of the page. */}
          {yearHasLongRange && firstLongRange && (
            <p className="-mt-6 mb-8 text-xs text-muted-foreground">
              From {formatDate(firstLongRange, { year: "always" })}, amounts assume today&apos;s
              holdings, each dividend grown at its own rate. No new buys or reinvestment; for those,
              see{" "}
              <Link
                href="/goal"
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                your goal
              </Link>
              .
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
