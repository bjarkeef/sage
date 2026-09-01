import type { ImportTransactionType } from "./types";

/**
 * Resolve a broker's word for what happened into one of Sage's four types.
 *
 * Header matching has always been fuzzy while value matching demanded an exact
 * hit, which is backwards: `Fees & Comm` found the fee column but `Cash
 * Dividend` was an unknown type. Real exports say "Cash Dividend", "Buy Trade",
 * "SELL - MARKET". So match on whole words inside the value.
 *
 * Whatever still does not resolve is reported back to the user to map by hand
 * rather than guessed at — see `resolution` below. A wrong type silently
 * rewrites someone's cost basis.
 */
const TYPE_ALIASES: Record<ImportTransactionType, string[]> = {
  buy: ["buy", "b", "bought", "purchase", "purchased", "acquisition", "kauf", "kob", "kjop"],
  sell: ["sell", "s", "sold", "sale", "disposal", "redemption", "verkauf", "salg"],
  dividend: ["dividend", "dividends", "div", "dividende", "distribution", "udbytte", "utdelning"],
  split: ["split", "splits"],
};

const TYPES = Object.keys(TYPE_ALIASES) as ImportTransactionType[];

/** Lowercase, punctuation to spaces, runs collapsed. "SELL - MARKET" → "sell market". */
export function normalizeTypeValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type TypeResolution =
  | { ok: true; type: ImportTransactionType }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "unknown"; value: string }
  | { ok: false; reason: "ambiguous"; value: string; matches: ImportTransactionType[] };

/**
 * @param overrides User-supplied value→type decisions, keyed by normalized
 *   value. Consulted first: the user looking at their own export beats any
 *   alias table we ship.
 */
export function resolveType(
  raw: string,
  overrides: Record<string, ImportTransactionType> = {},
): TypeResolution {
  const value = normalizeTypeValue(raw);
  if (!value) return { ok: false, reason: "empty" };

  const override = overrides[value];
  if (override) return { ok: true, type: override };

  const words = new Set(value.split(" "));
  const matches = TYPES.filter((type) => TYPE_ALIASES[type].some((alias) => words.has(alias)));

  if (matches.length === 1) return { ok: true, type: matches[0]! };
  if (matches.length > 1) return { ok: false, reason: "ambiguous", value, matches };
  return { ok: false, reason: "unknown", value };
}

/** Human-readable reason for the skipped-rows table. */
export function describeTypeFailure(res: Extract<TypeResolution, { ok: false }>): string {
  if (res.reason === "empty") return "Missing transaction type";
  if (res.reason === "ambiguous") {
    return `Type "${res.value}" could mean ${res.matches.join(" or ")} — map it explicitly`;
  }
  return `Unrecognised type "${res.value}" — map it on the previous step`;
}
