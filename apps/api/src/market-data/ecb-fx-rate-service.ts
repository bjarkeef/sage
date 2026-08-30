import type { IHistoricalFxRateService, FxSeries } from "@sage/provider-interface";
import type { CurrencyCode } from "@sage/core";
import { Decimal } from "@sage/core";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { fxRateDaily } from "../db/schema";
import { triggerEcbRefresh, type RateFeed } from "./ecb-sync";

/**
 * FX rates served from the locally stored ECB reference series.
 *
 * Spot rates come from the newest stored publication day. Because ECB publishes
 * only on TARGET business days, "newest stored" is Friday's row all weekend —
 * that is correct, not stale, and staleness is judged separately on a 7-day
 * threshold (see fx-provenance.ts).
 *
 * Honesty contract, unchanged from the services this replaces: a pair that
 * cannot be priced is OMITTED from `getRates` and throws from `getRate`, never
 * faked at 1:1.
 */
export class EcbFxRateService implements IHistoricalFxRateService {
  constructor(
    private readonly db: Database,
    /**
     * When supplied, every read nudges a background catch-up. Optional so a
     * test can read a seeded table without any network wiring.
     */
    private readonly feed?: RateFeed,
  ) {}

  /**
   * Fire-and-forget catch-up on the read path.
   *
   * This service is the single funnel every FX read passes through, which
   * makes it the one place a refresh can be hung without threading the feed
   * into every route and view. Safe to call on each read: `triggerEcbRefresh`
   * never rejects, is `inFlight`-guarded, and throttles to one network attempt
   * per 6 hours, so the cost of the extra calls is a boolean check.
   */
  private refresh(): void {
    if (this.feed) triggerEcbRefresh(this.db, this.feed);
  }

  /** Newest stored publication date, or null when nothing is stored yet. */
  async latestDate(): Promise<string | null> {
    const [row] = await this.db
      .select({ date: sql<string>`max(${fxRateDaily.date})` })
      .from(fxRateDaily);
    return row?.date ?? null;
  }

  /**
   * Spot rate to convert one unit of `from` into `to`, as of the newest
   * stored publication day.
   *
   * @throws if the pair cannot be priced — never fakes a 1:1 rate.
   */
  async getRate(from: CurrencyCode, to: CurrencyCode): Promise<Decimal> {
    if (from === to) return new Decimal(1);
    const rates = await this.getRates(from, [to]);
    const rate = rates.get(to);
    if (!rate) throw new Error(`FX rate unavailable: ${from}->${to}`);
    return rate;
  }

  /**
   * Spot rates to convert one unit of `base` into each of `targets`, as of
   * the newest stored publication day.
   *
   * A `target` that cannot be priced is simply absent from the returned map
   * — it is never faked at 1:1.
   */
  async getRates(base: CurrencyCode, targets: CurrencyCode[]): Promise<Map<CurrencyCode, Decimal>> {
    this.refresh();
    const result = new Map<CurrencyCode, Decimal>();
    const wanted = [...new Set(targets)].filter((t) => {
      if (t === base) {
        result.set(t, new Decimal(1));
        return false;
      }
      return true;
    });
    if (wanted.length === 0) return result;

    const date = await this.latestDate();
    if (!date) return result;

    const rows = await this.db
      .select({ currency: fxRateDaily.currency, rate: fxRateDaily.rate })
      .from(fxRateDaily)
      .where(eq(fxRateDaily.date, date));

    const perEur = new Map<string, Decimal>([["EUR", new Decimal(1)]]);
    for (const row of rows) perEur.set(row.currency, new Decimal(row.rate));

    const basePerEur = perEur.get(base);
    if (!basePerEur) return result; // base itself unpriceable — nothing converts

    for (const target of wanted) {
      const targetPerEur = perEur.get(target);
      if (!targetPerEur) continue; // omitted, never faked
      result.set(target, targetPerEur.dividedBy(basePerEur));
    }
    return result;
  }

  /**
   * Loads every rate needed to convert `targets` into `base` across
   * `[from, to]` in a single query, forward-filling days ECB does not
   * publish (weekends and TARGET holidays) from the most recent earlier
   * publication day.
   *
   * The query reaches 10 days before `from` so a range that starts on, say,
   * a Monday can still forward-fill from the preceding Friday's row.
   *
   * Coverage (`FxSeries.coversFrom`) only begins once EVERY needed currency
   * has a row on or before that date — a date that can price some but not
   * all of `targets` cannot price the whole book.
   */
  async getRateSeries(
    base: CurrencyCode,
    targets: CurrencyCode[],
    from: string,
    to: string,
  ): Promise<FxSeries> {
    this.refresh();
    const wanted = [...new Set(targets)].filter((t) => t !== base);
    // The base's own EUR row is needed to cross-rate, and EUR is implicit.
    const needed = [...new Set([...wanted, base])].filter((c) => c !== "EUR");

    // Widen the lower bound: a date at the very start of the window may need
    // forward-filling from a publication day BEFORE it (a Monday range start
    // reaches back to the previous Friday). 10 days covers any TARGET closure.
    const lookback = new Date(`${from}T00:00:00Z`);
    lookback.setUTCDate(lookback.getUTCDate() - 10);
    const fetchFrom = lookback.toISOString().slice(0, 10);

    const rows =
      needed.length === 0
        ? []
        : await this.db
            .select({
              date: fxRateDaily.date,
              currency: fxRateDaily.currency,
              rate: fxRateDaily.rate,
            })
            .from(fxRateDaily)
            .where(
              and(
                gte(fxRateDaily.date, fetchFrom),
                lte(fxRateDaily.date, to),
                inArray(fxRateDaily.currency, needed),
              ),
            );

    // currency -> sorted [date, ratePerEur][], for forward-fill by binary search.
    const byCurrency = new Map<string, { date: string; rate: Decimal }[]>();
    for (const row of rows) {
      const list = byCurrency.get(row.currency) ?? [];
      list.push({ date: row.date, rate: new Decimal(row.rate) });
      byCurrency.set(row.currency, list);
    }
    for (const list of byCurrency.values()) list.sort((a, b) => a.date.localeCompare(b.date));

    /** Latest rate on or before `date`; null when the series starts later. */
    const perEurOn = (currency: string, date: string): Decimal | null => {
      if (currency === "EUR") return new Decimal(1);
      const list = byCurrency.get(currency);
      if (!list || list.length === 0) return null;
      let lo = 0;
      let hi = list.length - 1;
      let found: Decimal | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid]!.date <= date) {
          found = list[mid]!.rate;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found;
    };

    // Coverage starts once EVERY needed currency has a row — a partial date
    // cannot price the whole book, and reporting it as covered would silently
    // drop one holding from that day's total.
    let coversFrom: string | null = null;
    if (needed.length === 0) {
      coversFrom = from;
    } else {
      const firsts = needed.map((c) => byCurrency.get(c)?.[0]?.date ?? null);
      coversFrom = firsts.some((d) => d === null)
        ? null
        : firsts.reduce((max, d) => (d! > max! ? d : max), firsts[0])!;
    }

    return {
      coversFrom,
      rateOn(date: string, currency: CurrencyCode): Decimal | null {
        if (currency === base) return new Decimal(1);
        const basePerEur = perEurOn(base, date);
        const targetPerEur = perEurOn(currency, date);
        if (!basePerEur || !targetPerEur) return null;
        return targetPerEur.dividedBy(basePerEur);
      },
    };
  }
}
