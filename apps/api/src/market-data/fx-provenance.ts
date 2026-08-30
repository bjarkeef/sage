import type { IFxRateService } from "@sage/provider-interface";
import type { CurrencyCode, Decimal } from "@sage/core";

/** Rates older than this are reported as stale. Chosen to absorb weekends and
 *  TARGET holidays without modelling a calendar: ECB's longest normal closure
 *  is well under a week, so anything beyond it means the instance is not
 *  reaching ECB. */
export const STALE_AFTER_DAYS = 7;

/** Rates plus the provenance a view needs to caveat its totals honestly. */
export interface TaggedRates {
  rates: Map<CurrencyCode, Decimal>;
  /** Publication date the rates come from; null when nothing is stored. */
  asOf: string | null;
  /** `asOf` is older than {@link STALE_AFTER_DAYS}. */
  stale: boolean;
}

/** An FX service that can report which publication day it served. */
interface DatedFxRateService extends IFxRateService {
  latestDate(): Promise<string | null>;
}

function hasLatestDate(fx: IFxRateService): fx is DatedFxRateService {
  return typeof (fx as Partial<DatedFxRateService>).latestDate === "function";
}

/**
 * Reads rates along with how current they are.
 *
 * Lets views ask "should I caveat this total?" without widening every route
 * signature. A service that cannot report a date (a test stub) is treated as
 * fresh — it has no staleness to disclose.
 */
export async function getRatesWithProvenance(
  fx: IFxRateService,
  base: CurrencyCode,
  targets: CurrencyCode[],
): Promise<TaggedRates> {
  const rates = await fx.getRates(base, targets);
  if (!hasLatestDate(fx)) return { rates, asOf: null, stale: false };

  const asOf = await fx.latestDate();
  if (asOf === null) return { rates, asOf: null, stale: false };

  const ageDays = Math.floor((Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return { rates, asOf, stale: ageDays > STALE_AFTER_DAYS };
}
