import type { Decimal, CurrencyCode } from "@sage/core";

/**
 * Provider-independent contract for FX rate lookups.
 *
 * Kept separate from {@link IMarketDataProvider} so it can be backed by any
 * source (EODHD, ECB, etc.) and injected as its own dependency.
 */
export interface IFxRateService {
  getRate(from: CurrencyCode, to: CurrencyCode): Promise<Decimal>;
  getRates(base: CurrencyCode, targets: CurrencyCode[]): Promise<Map<CurrencyCode, Decimal>>;
}

/**
 * A date-indexed view of FX rates for one base currency, as returned by
 * {@link IHistoricalFxRateService.getRateSeries}.
 */
export interface FxSeries {
  /**
   * Rate for `currency` on `date`, forward-filled from the most recent earlier
   * publication day (ECB publishes only on TARGET business days, so weekends
   * and holidays legitimately have no row of their own).
   *
   * Direction matches {@link IFxRateService.getRates}: **units of `currency`
   * per 1 unit of the series base**, so a `currency` amount is DIVIDED by it to
   * land in the base currency.
   *
   * Null when the pair cannot be priced on or before that date.
   *
   * @param date ISO `YYYY-MM-DD`.
   */
  rateOn(date: string, currency: CurrencyCode): Decimal | null;
  /** Earliest date this series can price at all; null when it holds nothing. */
  coversFrom: string | null;
}

/**
 * An {@link IFxRateService} that can also price a date range in one call.
 *
 * Kept separate so consumers needing only spot rates are unaffected, and so a
 * source without history can still satisfy the base contract.
 */
export interface IHistoricalFxRateService extends IFxRateService {
  /**
   * Loads every rate needed to convert `targets` into `base` across
   * `[from, to]` in a single query.
   *
   * @param from ISO `YYYY-MM-DD`, inclusive.
   * @param to ISO `YYYY-MM-DD`, inclusive.
   */
  getRateSeries(
    base: CurrencyCode,
    targets: CurrencyCode[],
    from: string,
    to: string,
  ): Promise<FxSeries>;
}
