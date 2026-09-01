import { Decimal } from "@sage/core";

/**
 * Read a number the way a broker actually writes one.
 *
 * Exports are not written for machines. Prices arrive as `$241.30`, quantities
 * as `1,200`, European fees as `1.234,56`, Swiss ones as `1'234.56`, and
 * credits as `(1,234.56)`. The previous parser accepted a bare decimal string
 * and nothing else, so a leading currency symbol failed the whole row.
 *
 * Returns a canonical decimal string, keeping the sign — callers decide whether
 * a negative value is meaningful for their field. Returns null only when the
 * text carries no readable number at all, which callers must report differently
 * from a number they understood and rejected.
 */
export function parseNumber(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  // Accounting notation: (1,234.56) is negative.
  let negative = false;
  const wrapped = s.match(/^\((.*)\)$/);
  if (wrapped) {
    negative = true;
    s = wrapped[1]!.trim();
  }

  // A sign may sit on either side of a currency symbol: -$5, $-5, 5-.
  if (/^[+-]/.test(s)) {
    if (s.startsWith("-")) negative = !negative;
    s = s.slice(1);
  }

  // Currency symbols, ISO codes, percent signs, stray labels. Whatever is left
  // must be digits and separators; anything else means we did not understand it.
  s = s.replace(/[^\d.,'’\s]/g, "");
  // Grouping by space (French, Nordic) or apostrophe (Swiss), including the
  // non-breaking and thin spaces that spreadsheets emit.
  s = s.replace(/[\s'’]/g, "");
  if (!s) return null;

  const normalized = normalizeSeparators(s);
  if (normalized === null) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  try {
    const d = new Decimal(negative ? `-${normalized}` : normalized);
    if (!d.isFinite()) return null;
    return d.toFixed();
  } catch {
    return null;
  }
}

/** Digits plus `.` and `,` → a plain decimal string, or null if incoherent. */
function normalizeSeparators(s: string): string | null {
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  // Both separators present: the rightmost is the decimal point, whichever it
  // is. 1,234.56 and 1.234,56 both resolve without guessing a locale.
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    return s.split(groupSep).join("").replace(decimalSep, ".");
  }

  if (lastComma >= 0) return resolveSingleSeparator(s, ",");
  if (lastDot >= 0) return resolveSingleSeparator(s, ".", { requireRepeat: true });
  return s;
}

/**
 * One kind of separator, used either as grouping or as a decimal point.
 *
 * `1,50` is fifty cents and `1,200` is twelve hundred, so the count of trailing
 * digits decides — three of them, in properly sized groups, means grouping. A
 * leading zero rules grouping out: nobody writes 0,123 for one hundred
 * twenty-three.
 *
 * A lone dot is left as a decimal point unless it repeats (`requireRepeat`),
 * because `1.234` is far more often a price than it is European for 1234.
 */
function resolveSingleSeparator(
  s: string,
  sep: "." | ",",
  opts: { requireRepeat?: boolean } = {},
): string | null {
  const escaped = sep === "." ? "\\." : ",";
  const occurrences = s.split(sep).length - 1;
  const groupedPattern = new RegExp(`^\\d{1,3}(${escaped}\\d{3})+$`);
  const isGrouped = groupedPattern.test(s) && !s.startsWith(`0${sep}`);

  if (isGrouped && (occurrences > 1 || !opts.requireRepeat)) {
    return s.split(sep).join("");
  }
  // Repeated separators that are not clean groups are not a number we can read.
  if (occurrences > 1) return null;
  return sep === "," ? s.replace(",", ".") : s;
}
