/**
 * Accept a decimal comma in a typed amount: "1,12" becomes "1.12".
 *
 * Only a single comma with no dot is rewritten. Anything with grouping — "1.000,50",
 * "1,000.50", "1,000,000" — is returned as typed, so validation rejects it rather
 * than this guessing which separator is the decimal and storing a figure 1000× off.
 */
export function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();
  return /^[+-]?\d*,\d+$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
}

/** A typed amount as a number, or null when it is blank or not a number. */
export function parseDecimalInput(value: string): number | null {
  const normalized = normalizeDecimalInput(value);
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
