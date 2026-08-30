import { Decimal, type CurrencyCode } from "@sage/core";

/** One ECB publication day: rates expressed as units of each currency per 1 EUR. */
export interface RateDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  ratesPerEur: Map<CurrencyCode, Decimal>;
}

// ECB is inconsistent across its own feeds: eurofxref-daily.xml single-quotes
// attributes, eurofxref-hist.xml double-quotes them. Both forms are accepted
// here on purpose — a parser written against one file fails silently on the
// other, and that failure looks like "no rates" rather than an error.
const DAY_RE = /<Cube\s+time=['"]([0-9]{4}-[0-9]{2}-[0-9]{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
const RATE_RE = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/>/g;

/**
 * Parses any ECB `eurofxref` XML document into publication days.
 *
 * Tolerant by design: malformed input, an error page, or an unparseable rate
 * yields fewer entries rather than throwing, because every caller's degraded
 * path ("we have no rate for this") is already well defined and safe.
 *
 * @param xml Raw XML from any of the three eurofxref feeds.
 */
export function parseEurofxrefXml(xml: string): RateDay[] {
  const days: RateDay[] = [];
  DAY_RE.lastIndex = 0;
  let dayMatch: RegExpExecArray | null;
  while ((dayMatch = DAY_RE.exec(xml)) !== null) {
    const date = dayMatch[1]!;
    const body = dayMatch[2]!;
    const ratesPerEur = new Map<CurrencyCode, Decimal>();
    RATE_RE.lastIndex = 0;
    let rateMatch: RegExpExecArray | null;
    while ((rateMatch = RATE_RE.exec(body)) !== null) {
      const currency = rateMatch[1]!;
      const raw = rateMatch[2]!;
      // ECB writes "N/A" where a currency had no fixing that day.
      if (currency === "EUR") continue;
      let value: Decimal;
      try {
        value = new Decimal(raw);
      } catch {
        continue;
      }
      if (!value.isFinite() || value.lessThanOrEqualTo(0)) continue;
      ratesPerEur.set(currency, value);
    }
    days.push({ date, ratesPerEur });
  }
  return days;
}
