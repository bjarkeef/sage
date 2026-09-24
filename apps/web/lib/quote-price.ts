/**
 * A quote's price as a person would type it: "496.2699890136719" → "496.27".
 *
 * Yahoo delivers prices as float32, so a stored close carries the widening
 * noise of the double it was converted to. Harmless in a valuation, but a price
 * prefilled into a form is what gets saved. This picks the shortest decimal that
 * is still the same float32 value, which recovers the price as quoted. Rounding
 * to a fixed number of places cannot do that: at 338 the noise sits in the
 * fourth decimal, while a sub-unit price needs five or more.
 *
 * A string with at most 9 significant digits is returned as-is: it is already
 * clean, and "150.00" should keep the zeros it came with.
 */
export function cleanQuotePrice(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || significantDigits(amount) <= 9) return amount;
  const target = Math.fround(n);
  for (let p = 1; p <= 9; p++) {
    const candidate = Number(n.toPrecision(p));
    if (Math.fround(candidate) === target) return String(candidate);
  }
  return amount;
}

function significantDigits(amount: string): number {
  return amount.replace(/^[+-]?0*\.?0*/, "").replace(/\D/g, "").length;
}
