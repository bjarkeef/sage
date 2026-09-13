import { Card, ChartSkeleton, Skeleton } from "@sage/ui";

/** Mirrors `PageHeader`'s real geometry: `mb-8`, a 28px title, a 14px
 *  description line, and an optional right-aligned actions row. Every route's
 *  loading.tsx had been approximating this with its own one-off widths, so
 *  the title block visibly shifted on load on every route. */
export function PageHeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      {withActions && (
        <div className="flex flex-wrap items-center gap-3">
          {/* `Skeleton` doesn't forward arbitrary props (it only takes
              `className`), so the `data-skeleton-action` marker has to live
              on a wrapping element rather than the skeleton itself. */}
          <div data-skeleton-action>
            <Skeleton className="h-8 w-24 rounded-control" />
          </div>
          <div data-skeleton-action>
            <Skeleton className="h-8 w-32 rounded-control" />
          </div>
        </div>
      )}
    </div>
  );
}

/** For pages whose body is a card grid — the analytics bento, diversification,
 *  categories. `columns` must match the page's own track count or the
 *  skeleton reserves the wrong width and the grid jumps on load. */
export function CardGridSkeleton({
  cards = 6,
  columns = 3,
  height = "h-48",
}: {
  cards?: number;
  columns?: number;
  height?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid grid-cols-1 gap-5 ${columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}
    >
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className={`${height} rounded-card`} />
      ))}
    </div>
  );
}

/** The dividends month grid: a seven-column header row above six week rows,
 *  inside one rounded, clipping shell — the same structure the real grid
 *  uses, so the calendar does not resize when events arrive. */
export function CalendarSkeleton() {
  return (
    <div role="status" aria-label="Loading calendar" className="overflow-x-auto">
      <div className="min-w-[36rem] overflow-hidden rounded-card border border-border">
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="bg-background p-2">
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: 42 }, (_, i) => (
            <div key={i} className="h-20 bg-background p-2">
              <Skeleton className="h-3 w-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Mirrors the ambient PortfolioChart block (range control row + 200px chart +
 *  legend row) so the lazy-chunk fallback, first-load, and the route skeleton
 *  all reserve the same height the loaded chart occupies — no layout shift. */
export function AmbientChartSkeleton() {
  return (
    <div role="status" aria-label="Loading chart" className="space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-60 rounded-full" />
      </div>
      <Skeleton className="h-50 w-full rounded-card" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
    </div>
  );
}

/**
 * The overview's own shape: eyebrow, figure, the line under it, a full-bleed
 * plot and the three-figure ledger.
 *
 * Every measurement here is the real one — `horizon-num`'s clamp resolves to a
 * 108px line at desktop width, the plot is `h-65`, the ledger's rows are what
 * `Stat` at `size="md"` occupies — because a skeleton whose proportions are
 * approximate is a layout shift with extra steps.
 */
export function HorizonSkeleton() {
  return (
    <div role="status" aria-label="Loading portfolio" className="space-y-5">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-[clamp(48px,8vw,108px)] w-[min(560px,80%)]" />
        <Skeleton className="h-6 w-[min(420px,70%)]" />
      </div>
      {/* Out through the column's gutters, exactly as the plot is. */}
      <Skeleton className="-mx-4 h-65 w-auto rounded-none sm:-mx-8" />
      <div className="grid grid-flow-row gap-6 pt-1 sm:grid-flow-col sm:auto-cols-fr sm:gap-0">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 sm:px-6 sm:first:pl-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mirrors the overview hero layout so loading causes no layout shift. */
export function HeroSkeleton() {
  return (
    <div role="status" aria-label="Loading portfolio" className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64 rounded-full" />
      </div>
      <div>
        <Skeleton className="h-12 w-64" />
        <Skeleton className="mt-2 h-5 w-24 rounded-full" />
      </div>
      <Skeleton className="h-60 w-full rounded-card" />
    </div>
  );
}

/** Generic data-row placeholders (logo circle + two lines + right-aligned bar). */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-0.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-skeleton-row className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Matches the quiet stat strip's rhythm. */
export function StatStripSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading stats"
      className="grid grid-cols-2 gap-y-6 md:grid-cols-4 md:divide-x md:divide-hairline"
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} data-skeleton-stat className={i === 0 ? "md:pr-6" : "md:px-6"}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-page composed skeletons. One per route, each carrying a
// `data-skeleton-shape` attribute naming its page. The route's loading.tsx
// and the page's own in-page loading branch both render the SAME component
// below, so a single navigation shows one shape start to finish instead of
// the route file and the in-page branch disagreeing (the /goal bug this task
// fixes: a 380px card beside a chart, then six avatar rows, then the real
// twelve-column grid — three shapes for one navigation).
// ---------------------------------------------------------------------------

/** `/` — greeting header, value hero, ambient chart, then the 2x2 card grid
 *  (Performance/Income/Portfolio/Upcoming). No in-page loading branch exists
 *  for this route (OverviewClient returns `null` while its prefetched query
 *  hydrates, which resolves before first paint), so only `loading.tsx`
 *  renders this. */
export function OverviewPageSkeleton() {
  return (
    <div data-skeleton-shape="overview">
      {/* One eyebrow and the two quiet controls — the greeting is no longer up
          here, so neither is its placeholder. */}
      <header className="mb-12 flex items-center justify-between pt-6 sm:mb-16 sm:pt-12">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </header>

      <section className="mb-14 sm:mb-20">
        <HorizonSkeleton />
        {/* The goal band's own reserved height, so the shape below it does not
            move when the goal query lands. */}
        <div className="mt-5 space-y-3 border-t border-hairline-faint pt-5">
          <Skeleton className="h-5 w-[min(440px,70%)]" />
          <Skeleton className="h-[3px] w-full rounded-full" />
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}

/** `/holdings` — `PageHeader` with actions (Task 8 moved "Add custom
 *  holding" and "Add transaction" into the header), the holdings rows, then
 *  an "Activity" section of transaction rows. No in-page loading branch
 *  (HoldingsClient returns `null` while its prefetched query hydrates), so
 *  only `loading.tsx` renders this. */
export function HoldingsPageSkeleton() {
  return (
    <div data-skeleton-shape="holdings">
      <PageHeaderSkeleton withActions />
      <RowsSkeleton rows={5} />
      <div className="mt-12">
        <Skeleton className="mb-4 h-4 w-24" />
        <RowsSkeleton rows={4} />
      </div>
    </div>
  );
}

/** `/performance` — header, hero figure + range control, the stat strip,
 *  then the chart. No in-page loading branch: `PerformancePage` fetches on
 *  the server and hydrates `PerformanceStudio` directly, so only
 *  `loading.tsx` renders this. */
export function PerformancePageSkeleton() {
  return (
    <div data-skeleton-shape="performance">
      <PageHeaderSkeleton />
      <div className="mt-6 space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-56 rounded-full" />
          </div>
          <div>
            <Skeleton className="h-12 w-40" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        </div>
        <StatStripSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

/** `/dividends` — header with actions (year picker, calendar/list toggle,
 *  the "..." menu), the summary-card + income-bars band, the status-filter
 *  chip row, then the calendar grid. Not the four-tile stat strip the page
 *  had before the calendar rework — that shape hasn't existed since. Shared
 *  by `loading.tsx` and the page's own `loading && !data` branch. */
export function DividendsPageSkeleton() {
  return (
    <div data-skeleton-shape="dividends">
      <PageHeaderSkeleton withActions />
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <Skeleton className="h-48 rounded-card" />
        <Skeleton className="h-48 rounded-card" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <CalendarSkeleton />
    </div>
  );
}

/** `/dividends/analytics` — header with actions (the "back to Dividends"
 *  link), then the six-card bento (KPI row, income composition, timeline,
 *  forward payments, growth leaders, yield-by-holding, monthly rhythm, plus
 *  the holdings table — approximated as six uniform cards rather than every
 *  exact `col-span`). Shared by `loading.tsx` and the page's own `loading`
 *  branch. */
export function AnalyticsPageSkeleton() {
  return (
    <div data-skeleton-shape="dividends-analytics">
      <PageHeaderSkeleton withActions />
      <CardGridSkeleton cards={6} columns={3} />
    </div>
  );
}

/** `/goal` — header, then `grid-cols-12`: a `md:col-span-4` form column
 *  beside a `md:col-span-8` results column (progress hero, projection chart,
 *  callouts, results table). Before this fix a single navigation showed
 *  three different shapes in sequence — this is the one shape `loading.tsx`
 *  and the page's own `isLoading` branch now share. */
export function GoalPageSkeleton() {
  return (
    <div data-skeleton-shape="goal">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-4">
          <Skeleton className="h-96 rounded-card" />
        </div>
        <div className="col-span-12 space-y-5 md:col-span-8">
          <Skeleton className="h-20 rounded-card" />
          <ChartSkeleton className="h-64" />
          <Skeleton className="h-16 rounded-card" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** `/categories` — header with actions (Edit), then the real
 *  `lg:grid-cols-[240px_1fr]` split: a narrow allocation-donut card beside
 *  the browser table, whose rows carry a logo circle same as `RowsSkeleton` —
 *  a card grid of uniform tiles would misdescribe this page, which is one
 *  card, not several. Shared by `loading.tsx` and `CategoriesClient`'s
 *  `isPending` branch. */
export function CategoriesPageSkeleton() {
  return (
    <div data-skeleton-shape="categories">
      <PageHeaderSkeleton withActions />
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <Skeleton className="h-72 rounded-card" />
        <RowsSkeleton rows={6} />
      </div>
    </div>
  );
}

/** `/diversification` — header, the three X-Ray/Buy-in/Show-holdings toggle
 *  chips, then the `md:grid-cols-2` card grid (a wide "All holdings" card
 *  spanning both columns, plus one card per dimension) — card grids, not the
 *  avatar rows `RowsSkeleton` used to show here. Shared by `loading.tsx` and
 *  `DiversificationClient`'s `isPending` branch. */
export function DiversificationPageSkeleton() {
  return (
    <div data-skeleton-shape="diversification">
      <PageHeaderSkeleton />
      <div className="mb-5 flex flex-wrap gap-6">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-32 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Skeleton className="h-40 rounded-card md:col-span-2" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}

/** `/settings` — narrow shell, page title, then three switch-row sections.
 *  No in-page loading branch: `SettingsPage` renders its switches
 *  immediately (disabled until settings hydrate), so only `loading.tsx`
 *  renders this. Not listed in this task's brief interfaces, but `settings/`
 *  is in its file list — added for the same reason every other route got
 *  one: a hand-rolled loading.tsx here still drifts from the page the same
 *  way the others did. */
export function SettingsPageSkeleton() {
  return (
    <div data-skeleton-shape="settings">
      <Skeleton className="mb-8 h-8 w-40" />
      {Array.from({ length: 3 }, (_, s) => (
        <div key={s} className="mt-8 space-y-3">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** `/asset/[symbol]` — back link + currency picker, the identity header
 *  (logo, name, action button), the price chart, then the position strip.
 *  Shared by `loading.tsx` and `AssetDetailPage`'s own `isLoading` branch,
 *  which previously only reserved the chart and dropped the header entirely
 *  — the header used to jump into place the moment data landed. */
export function AssetPageSkeleton() {
  return (
    <div data-skeleton-shape="asset">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-28 rounded-control" />
      </div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Skeleton className="h-9 w-36 rounded-control" />
      </div>
      <div className="mb-10">
        <ChartSkeleton />
      </div>
      <StatStripSkeleton />
    </div>
  );
}

/** `/news` — header, then rows with a thumbnail on the right, inside one
 *  card. No route skeleton existed before this task; the row shape is lifted
 *  from the page's own (previously un-exported, un-shared) `NewsFeedSkeleton`,
 *  now shared by `loading.tsx` and the page's own `isLoading` branch. */
export function NewsPageSkeleton() {
  return (
    <div data-skeleton-shape="news">
      <PageHeaderSkeleton />
      <Card role="status" aria-label="Loading news">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex items-start gap-4 border-b border-hairline-faint py-3 first:pt-0 last:border-0 last:pb-0"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-control" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-14 w-14 rounded-control" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** `/import` — narrow: format toggle, then the dropzone. `ImportPage` has no
 *  data fetch gating its first paint (the wizard starts on `step ===
 *  "upload"` synchronously), so this is a route-transition skeleton only —
 *  there is no in-page branch to pair it with. */
export function ImportPageSkeleton() {
  return (
    <div data-skeleton-shape="import">
      <PageHeaderSkeleton />
      <div className="mt-6 space-y-4">
        <Skeleton className="h-9 w-56 rounded-control" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </div>
  );
}
