import { formatMonthYear } from "../format";
import { payFrequency } from "../income-tape/aggregates";
import type {
  AssetDetailDTO,
  AssetDividendsDTO,
  AssetUpcomingDTO,
  MoneyDTO,
  PositionDTO,
} from "../types";

/** A figure, or the reason Sage can't give one. Rendered as "—" with the reason
 *  — never as a zero. */
export type Figure<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Figure<T> => ({ ok: true, value });
const missing = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export const REASONS = {
  noDividends: "No dividends on record",
  noneExpected: "No payments expected in the next 12 months",
  noQuote: "No current price",
  mixedCurrency: "Dividends and price are in different currencies",
  notHeld: "Not in your book",
  noBook: "Your book has not loaded",
  noBookValue: "Your book has no market value to weigh it against",
  // Spec decision 3: without a display currency the book's values stay in each
  // holding's own currency, and a weight would be a sum across currencies.
  mixedBookCurrency: "Set a display currency to compare holdings in different currencies",
  providerNone: "The provider has no figure",
} as const;

export function shiftDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The day the cash lands: payment date, else ex-date — the tape's and /dividends' rule. */
export function cashDate(r: { exDate: string; paymentDate: string | null }): string {
  return r.paymentDate ?? r.exDate;
}

/**
 * Gross income over the next 12 months for `quantity` shares: every upcoming
 * row in the "next12m" window — what the overview's next-12-months figure sums
 * for this holding. Quantity 1 is the per-share figure.
 *
 * The ONE producer of "next 12 months" on the asset page: the strip's "Pays
 * you" and Your income both call it (spec: Data reliability 3).
 */
export function nextTwelveMonths(upcoming: AssetUpcomingDTO[], quantity: number): Figure<MoneyDTO> {
  const rows = upcoming.filter((u) => u.window === "next12m");
  if (rows.length === 0) return missing(REASONS.noneExpected);
  const currency = rows[0]!.currency;
  if (rows.some((r) => r.currency !== currency)) return missing(REASONS.mixedCurrency);
  const total = rows.reduce((s, r) => s + Number(r.amountPerShare) * quantity, 0);
  return ok({ amount: total.toFixed(6), currency });
}

/** The first payment whose cash lands after today. */
export function nextPayment(
  upcoming: AssetUpcomingDTO[],
  todayISO: string,
): AssetUpcomingDTO | null {
  return (
    [...upcoming]
      .filter((u) => cashDate(u) > todayISO)
      .sort((a, b) => cashDate(a).localeCompare(cashDate(b)))[0] ?? null
  );
}

/** "pays quarterly" etc., from the busier of the last 12 months' ex-dates and
 *  the next 12 months' — `payFrequency`, shared with the income tape. */
export function payFrequencyOf(
  history: AssetDividendsDTO["history"],
  upcoming: AssetUpcomingDTO[],
  todayISO: string,
): string | null {
  const yearAgo = shiftDays(todayISO, -365);
  const last = history.filter((h) => h.exDate > yearAgo && h.exDate <= todayISO).length;
  const next = upcoming.filter((u) => u.window === "next12m" && u.exDate > todayISO).length;
  return payFrequency(Math.max(last, next));
}

/** Gross current yield: the endpoint's trailing-12-month dividend ÷ the header
 *  quote. The strip and Buy more? both read it here. */
export function currentYield(detail: Pick<AssetDetailDTO, "income" | "quote">): Figure<number> {
  if (detail.income.currentYield != null) return ok(detail.income.currentYield);
  if (!detail.quote) return missing(REASONS.noQuote);
  if (!detail.income.annualDividend) return missing(REASONS.noDividends);
  return missing(REASONS.mixedCurrency);
}

/** Upside to the analysts' mean target from the HEADER price — never the
 *  provider's own `currentPrice`, which is how the page came to show two
 *  current prices. */
export function analystUpside(
  mean: MoneyDTO | null,
  quote: AssetDetailDTO["quote"],
): Figure<{ abs: number; pct: number; currency: string }> {
  if (!mean) return missing(REASONS.providerNone);
  if (!quote) return missing(REASONS.noQuote);
  if (mean.currency !== quote.price.currency) {
    return missing(`Target in ${mean.currency}, price in ${quote.price.currency}`);
  }
  const price = Number(quote.price.amount);
  if (price === 0) return missing(REASONS.noQuote);
  const abs = Number(mean.amount) - price;
  return ok({ abs, pct: (abs / price) * 100, currency: quote.price.currency });
}

/**
 * This holding's share of the book's market value (the /holdings rule).
 *
 * The ONE producer of weight on the page (strip and Your position). Never a
 * sum across currencies (spec decision 3): /portfolio sends every value in the
 * display currency when one is set, and in each holding's own currency when
 * not — then, if the priced values are in more than one currency, there is no
 * total to weigh against and the answer is "—" with the reason. A value the
 * server could not convert (no ECB rate) stays in its own currency too, and is
 * refused the same way rather than added in.
 */
export function holdingWeight(
  positions: PositionDTO[] | undefined,
  symbol: string,
): Figure<number> {
  if (!positions) return missing(REASONS.noBook);
  const position = positions.find((p) => p.symbol === symbol);
  if (!position) return missing(REASONS.notHeld);
  const mine = position.marketValue;
  if (!mine) return missing(REASONS.noQuote);
  const valued = positions.flatMap((p) => (p.marketValue ? [p.marketValue] : []));
  if (valued.some((v) => v.currency !== mine.currency)) return missing(REASONS.mixedBookCurrency);
  const total = valued.reduce((s, v) => s + Number(v.amount), 0);
  if (total <= 0) return missing(REASONS.noBookValue);
  return ok(Number(mine.amount) / total);
}

/** A holding's weight as shown: one decimal, "8.0%". */
export function formatWeight(weight: number): string {
  return `${(weight * 100).toFixed(1)}%`;
}

export type RangePlace = "below" | "low" | "middle" | "high" | "above";

/** Where `current` sits in [low, high], in thirds. */
export function rangePlace(low: number, high: number, current: number): RangePlace {
  if (current < low) return "below";
  if (current > high) return "above";
  if (high === low) return "middle";
  const t = (current - low) / (high - low);
  if (t <= 1 / 3) return "low";
  if (t >= 2 / 3) return "high";
  return "middle";
}

const PLACE_WORDS: Record<RangePlace, string> = {
  below: "below",
  low: "low of",
  middle: "middle of",
  high: "high of",
  above: "above",
};

/** How close to five years back the first sample must be to call it five years. */
const FULL_SPAN_SLACK_MONTHS = 2;

/** The yield range's basis as a noun phrase: "its 5-yr range" only when the
 *  first sample is within two months of five years before today; otherwise
 *  the span it actually covers, "its range since Mar 2024". */
export function yieldRangeBasis(from: string, todayISO: string): string {
  const limit = new Date(
    Date.UTC(
      Number(todayISO.slice(0, 4)) - 5,
      Number(todayISO.slice(5, 7)) - 1 + FULL_SPAN_SLACK_MONTHS,
      Number(todayISO.slice(8, 10)),
    ),
  )
    .toISOString()
    .slice(0, 10);
  return from <= limit ? "its 5-yr range" : `its range since ${formatMonthYear(from)}`;
}

/** "middle of its 5-yr range" / "high of its range since Mar 2024". */
export function rangePlacePhrase(place: RangePlace, from: string, todayISO: string): string {
  return `${PLACE_WORDS[place]} ${yieldRangeBasis(from, todayISO)}`;
}
