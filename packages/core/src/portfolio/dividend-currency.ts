/**
 * Which currency a symbol's provider dividends are really in, judged against
 * the dividends a broker actually booked for it.
 *
 * Providers label a dividend with the listing's currency. A UCITS fund listed
 * in EUR but distributing in USD then arrives as its USD amount tagged "EUR" —
 * while another fund's provider rows are genuine EUR conversions of a USD
 * distribution. Nothing in the provider's own payload tells the two apart; the
 * broker's ledger does. When the broker booked a payment in another currency
 * for the same per-share number, the provider's label is wrong; when the
 * numbers differ by roughly an exchange rate, the provider converted and is
 * right.
 *
 * Returns the currency the provider rows should carry, or null to keep their
 * label. Needs at least two matching payments, and more matches than
 * conversions, so one coincidence cannot relabel a history. `booked` must be
 * broker-booked rows only — never dividends Sage derived from these same
 * provider rows, which would agree with the label by construction. Pure.
 */
export function inferDividendCurrency(
  provider: {
    exDate: string;
    paymentDate: string | null;
    amountPerShare: string;
    currency: string;
  }[],
  booked: { tradeDate: string; price: string; currency: string }[],
): string | null {
  const votes = new Map<string, number>();
  let conversions = 0;
  for (const b of booked) {
    const p = nearest(provider, b.tradeDate);
    if (!p || p.currency === b.currency) continue;
    const ratio = Number(b.price) / Number(p.amountPerShare);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    if (Math.abs(ratio - 1) <= SAME_NUMBER) {
      votes.set(b.currency, (votes.get(b.currency) ?? 0) + 1);
    } else {
      conversions++;
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of votes) {
    if (count > bestCount) [best, bestCount] = [currency, count];
  }
  return best && bestCount >= MIN_MATCHES && bestCount > conversions ? best : null;
}

/** Per-share amounts within 1% are the same number, rounded differently. */
const SAME_NUMBER = 0.01;
const MIN_MATCHES = 2;
/** A booking pairs with a provider payment whose ex-date or payment date is
 *  this close — the gap the dividend dedupe already treats as one payment. */
const MAX_GAP_DAYS = 12;

function nearest<T extends { exDate: string; paymentDate: string | null }>(
  rows: T[],
  date: string,
): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const r of rows) {
    for (const d of [r.exDate, r.paymentDate]) {
      if (!d) continue;
      const gap = Math.abs(Date.parse(d) - Date.parse(date)) / 86_400_000;
      if (gap < bestGap) [best, bestGap] = [r, gap];
    }
  }
  return bestGap <= MAX_GAP_DAYS ? best : null;
}
