# Chart libraries

Sage uses **two** chart stacks on purpose. Do not collapse them without a
spike that preserves time-series UX.

| Library                              | Used for                                                 | Why keep it                                                                                                     |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **lightweight-charts** (TradingView) | Portfolio value, performance studio, asset price history | Dense financial time series: pan/zoom, crosshair, many points, low overhead. Already code-split (`*-lazy.tsx`). |
| **recharts**                         | Dividend analytics (bars, pie, leaders), goal projection | Categorical / short series, React-first composition, shared tooltips with design tokens.                        |

## Why not “recharts only”?

Recharts can draw line charts, but:

- Portfolio **ALL** history can be hundreds–thousands of bars; LWC is built for that interaction model.
- We already invested chart chrome in LWC (`chart-config.ts`, fey-minimal theme).
- Dual cost is mostly **download size**, not maintainability — recharts pages should `next/dynamic` like LWC.

## Why not “LWC only”?

Pie charts, grouped bars, and goal projection are awkward or heavyweight in LWC.
Recharts matches analytics bento layout better.

## Rules

1. **Time series with range scrubbing** → lightweight-charts + lazy wrapper.
2. **Analytics / discrete categories** → recharts + lazy wrapper on page entry.
3. Shared tooltip styling: `components/charts/chart-tooltip.tsx` + CSS tokens.
4. Do not add a third chart library.

## Lazy-loading

- LWC: `portfolio-chart-lazy.tsx`, `performance-studio-lazy.tsx`, asset page dynamic import.
- Recharts: prefer dynamic imports on `/dividends/analytics` and `/goal` so the
  overview/holdings routes never pay for recharts.

### One static import undoes every `dynamic()` on the page

Colour ramps, tooltip constants and other shared values must live in a module
that does **not** import a charting library — `components/charts/chart-theme.ts`
is the home for them.

`/dividends/analytics` deferred all six of its charts and still shipped
**279 kB** of First Load JS, against 171 kB for `/goal`, which defers the same
library. The cause was a single line: `holdings-dividend-table.tsx` — imported
statically by the page — took its `SEG` colour ramp from
`income-composition.tsx`, which imports recharts. That one constant put recharts
in the route's initial bundle, so the six `dynamic()` calls bought nothing.
Moving the ramp to `chart-theme.ts` took the route to **176 kB**.

The failure is silent: the page works, the charts still stream in, and only the
build output shows it. **When you add a `dynamic()` chart, check the route's
First Load JS in `pnpm build` afterwards** — a number in line with its
neighbours is the only evidence the deferral did anything.
