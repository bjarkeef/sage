import { Hono } from "hono";
import { z } from "zod";
import type { Decimal } from "@sage/core";
import type {
  FxSeries,
  IFxRateService,
  IHistoricalFxRateService,
  IMarketDataProvider,
} from "@sage/provider-interface";
import type { AppEnv } from "../middleware/session";
import { BENCHMARKS, fetchBenchmarkSeries } from "../services/valuation-series";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seriesQuery = z
  .object({
    id: z.string().min(1),
    from: isoDay,
    to: isoDay,
    /** The holding's currency: the line the benchmark is compared with is in it. */
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine((q) => q.from <= q.to);

/**
 * A benchmark's closes in the holding's currency, each at its own day's rate.
 *
 * `rateOn(date)` is the FxSeries direction — units of the benchmark's currency
 * per 1 unit of the holding's — so a close is DIVIDED by it. A day without a
 * rate carries the last known one forward; with no rate on the first bar there
 * is nothing to carry, and the answer is null. Never an unconverted bar.
 */
function convertBenchmarkBars(
  bars: { date: string; close: Decimal }[],
  rateOn: (date: string) => Decimal | null,
): { date: string; close: Decimal }[] | null {
  const out: { date: string; close: Decimal }[] = [];
  let last: Decimal | null = null;
  for (const b of bars) {
    const found = rateOn(b.date);
    const rate: Decimal | null = found && !found.isZero() ? found : last;
    if (!rate) return null;
    last = rate;
    out.push({ date: b.date, close: b.close.dividedBy(rate) });
  }
  return out;
}

/** Sage's per-day ECB series, or null when the service has no history (a spot
 *  rate would convert every day at today's rate — not a per-day conversion). */
async function ecbSeries(
  fxRateService: IFxRateService | undefined,
  base: string,
  target: string,
  from: string,
  to: string,
): Promise<FxSeries | null> {
  // Capability check, not instanceof — the same one valuation-series makes.
  const svc = fxRateService as Partial<IHistoricalFxRateService> | undefined;
  if (typeof svc?.getRateSeries !== "function") return null;
  try {
    return await svc.getRateSeries(base, [target], from, to);
  } catch {
    return null;
  }
}

/**
 * The total-return benchmarks /performance compares against, for one holding's
 * chart. Same `BENCHMARKS`, same `fetchBenchmarkSeries`, so an index means the
 * same series on both pages — and, like there, a benchmark that cannot be
 * fetched is absent (`series: null`), never replaced by a price index.
 *
 * Unlike /performance, the series comes back in the holding's currency (spec
 * decision, 2026-10-01): the holding's line is in its own currency, and a % change
 * in USD beside one in EUR compares two things. Converted with the stored ECB
 * series — the single FX source — before the client rebases it.
 *
 * Not cache-only: like GET /performance, the comparison is the whole point of
 * the request, so a cold series is fetched once and stored.
 */
export function benchmarksRoutes(provider: IMarketDataProvider, fxRateService?: IFxRateService) {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      benchmarks: Object.entries(BENCHMARKS).map(([id, b]) => ({ id, name: b.name })),
    }),
  );

  app.get("/series", async (c) => {
    const parsed = seriesQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const { id, from, to, currency } = parsed.data;
    if (!BENCHMARKS[id]) return c.json({ error: "unknown_benchmark" }, 400);

    const [fetched] = await fetchBenchmarkSeries(
      provider,
      [id],
      new Date(`${from}T00:00:00Z`),
      new Date(`${to}T23:59:59Z`),
    );
    if (!fetched) return c.json({ series: null, reason: "no_series" as const });

    let bars = fetched.bars;
    if (fetched.currency !== currency) {
      const fx = await ecbSeries(
        fxRateService,
        currency,
        fetched.currency,
        fetched.bars[0]!.date,
        fetched.bars[fetched.bars.length - 1]!.date,
      );
      const converted = fx
        ? convertBenchmarkBars(fetched.bars, (date) => fx.rateOn(date, fetched.currency))
        : null;
      if (!converted) return c.json({ series: null, reason: "no_fx_rate" as const });
      bars = converted;
    }

    return c.json({
      series: {
        id: fetched.id,
        name: fetched.name,
        currency,
        bars: bars.map((b) => ({ date: b.date, close: b.close.toFixed() })),
      },
      reason: null,
    });
  });

  return app;
}
