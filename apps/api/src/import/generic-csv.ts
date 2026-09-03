import Papa from "papaparse";
import { Decimal } from "@sage/core";
import { parseNumber } from "./parse-number";
import { resolveType, normalizeTypeValue, describeTypeFailure } from "./parse-type";
import { isSnowballCsv } from "./snowball-parser";
import type {
  ImportInstrument,
  ImportTransaction,
  ImportTransactionType,
  ParseResult,
  SkippedRow,
} from "./types";

/** User-supplied mapping from CSV header names → Sage fields. */
export interface ColumnMapping {
  symbol: string;
  type: string;
  quantity: string;
  price: string;
  /**
   * Optional when `defaultCurrency` is set: plenty of brokers serve one
   * currency and omit the column entirely.
   */
  currency?: string | null;
  tradeDate: string;
  fee?: string | null;
  feeCurrency?: string | null;
  exchange?: string | null;
  name?: string | null;
  /** Used when there is no currency column, or the cell is empty. */
  defaultCurrency?: string | null;
  defaultExchange?: string | null;
  /**
   * Broker words for what happened → Sage types, keyed by normalized value
   * (see `normalizeTypeValue`). The user's reading of their own export beats
   * our alias table, and is the only way to place a value like
   * "Reinvest Shares" that means different things at different brokers.
   */
  typeAliases?: Record<string, ImportTransactionType> | null;
  /**
   * How to read tradeDate cells.
   * - iso: YYYY-MM-DD (also accepts Date objects / ISO datetime)
   * - dmy: DD/MM/YYYY or DD.MM.YYYY
   * - mdy: MM/DD/YYYY
   * - auto: try iso, then dmy, then mdy
   */
  dateFormat?: "iso" | "dmy" | "mdy" | "auto";
}

/** One distinct value in a column, and what Sage would make of it. */
export interface ColumnValueSummary {
  value: string;
  normalized: string;
  count: number;
  /** Non-null only for values the type table places on its own. */
  resolved: ImportTransactionType | null;
}

export interface CsvInspectResult {
  headers: string[];
  /** First few data rows as objects keyed by header. */
  sampleRows: Record<string, string>[];
  rowCount: number;
  /** Best-effort guess for mapping; null fields when no confident match. */
  suggestedMapping: Partial<ColumnMapping>;
  /**
   * Distinct values for every low-cardinality column, so the mapping step can
   * show which type words it could not place before the user commits — and
   * without a second round trip when they change which column holds the type.
   */
  valuesByColumn: Record<string, ColumnValueSummary[]>;
  /**
   * Set when the file is a known broker format with a dedicated parser, which
   * reads meaning this one cannot: Snowball encodes the exchange in its own
   * column and a dividend's amount in `Quantity`. Mapping such a file column
   * by column loses both. The caller routes on this rather than trusting
   * whichever format tab happened to be selected.
   */
  detectedFormat: "snowball" | null;
}

/** Above this a column is free text (prices, dates), not a category. */
const MAX_DISTINCT_VALUES = 50;

/** Columns that must name a real CSV column. Currency is handled separately. */
const REQUIRED_COLUMNS = ["symbol", "type", "quantity", "price", "tradeDate"] as const;

const HEADER_ALIASES: Record<
  (typeof REQUIRED_COLUMNS)[number] | "currency" | "fee" | "feeCurrency" | "exchange" | "name",
  string[]
> = {
  symbol: ["symbol", "ticker", "isin", "instrument", "security", "code", "ric"],
  type: ["type", "side", "action", "event", "transaction type", "txn type", "operation"],
  quantity: ["quantity", "qty", "shares", "units", "amount (shares)", "share quantity"],
  price: ["price", "unit price", "share price", "execution price", "close"],
  currency: ["currency", "ccy", "curr", "iso currency"],
  tradeDate: ["date", "trade date", "tradedate", "transaction date", "settlement date", "time"],
  fee: ["fee", "fees", "commission", "cost", "feetax", "fee/tax"],
  feeCurrency: ["fee currency", "feecurrency", "commission currency"],
  exchange: ["exchange", "market", "mic", "venue"],
  name: ["name", "description", "instrument name", "security name", "title"],
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function cell(row: Record<string, string>, header: string | null | undefined): string {
  if (!header) return "";
  const v = row[header];
  return v == null ? "" : String(v).trim();
}

function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const byNorm = new Map(headers.map((h) => [normHeader(h), h]));
  const pick = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const hit = byNorm.get(k);
      if (hit) return hit;
    }
    // fuzzy: header includes alias
    for (const [n, original] of byNorm) {
      for (const k of keys) {
        if (n === k || n.includes(k) || k.includes(n)) return original;
      }
    }
    return undefined;
  };

  const suggested: Partial<ColumnMapping> = {
    symbol: pick(HEADER_ALIASES.symbol),
    type: pick(HEADER_ALIASES.type),
    quantity: pick(HEADER_ALIASES.quantity),
    price: pick(HEADER_ALIASES.price),
    currency: pick(HEADER_ALIASES.currency) ?? null,
    tradeDate: pick(HEADER_ALIASES.tradeDate),
    fee: pick(HEADER_ALIASES.fee) ?? null,
    feeCurrency: pick(HEADER_ALIASES.feeCurrency) ?? null,
    exchange: pick(HEADER_ALIASES.exchange) ?? null,
    name: pick(HEADER_ALIASES.name) ?? null,
    dateFormat: "auto",
  };
  return suggested;
}

function parseRows(text: string): { headers: string[]; data: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields?.filter((h) => h && h.length > 0) ?? [];
  const data = (parsed.data ?? []).filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== ""),
  );
  return { headers, data };
}

function summarizeValues(
  headers: string[],
  data: Record<string, string>[],
): Record<string, ColumnValueSummary[]> {
  const out: Record<string, ColumnValueSummary[]> = {};
  for (const h of headers) {
    const counts = new Map<string, { value: string; count: number }>();
    let tooMany = false;
    for (const row of data) {
      const raw = cell(row, h);
      if (!raw) continue;
      const key = normalizeTypeValue(raw);
      if (!key) continue;
      const hit = counts.get(key);
      if (hit) {
        hit.count += 1;
      } else {
        if (counts.size >= MAX_DISTINCT_VALUES) {
          tooMany = true;
          break;
        }
        counts.set(key, { value: raw, count: 1 });
      }
    }
    if (tooMany || counts.size === 0) continue;
    out[h] = [...counts.entries()]
      .map(([normalized, { value, count }]) => {
        const res = resolveType(value);
        return { value, normalized, count, resolved: res.ok ? res.type : null };
      })
      .sort((a, b) => b.count - a.count);
  }
  return out;
}

export function inspectCsv(text: string): CsvInspectResult {
  const { headers, data } = parseRows(text);
  return {
    headers,
    sampleRows: data.slice(0, 8).map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = cell(r, h);
      return out;
    }),
    rowCount: data.length,
    suggestedMapping: suggestMapping(headers),
    valuesByColumn: summarizeValues(headers, data),
    detectedFormat: isSnowballCsv(text) ? "snowball" : null,
  };
}

interface DateParse {
  date: string | null;
  /** True when D/M and M/D both read, and disagree, under "auto". */
  ambiguous: boolean;
}

function parseDate(raw: string, format: ColumnMapping["dateFormat"]): DateParse {
  const s = raw.trim();
  if (!s) return { date: null, ambiguous: false };

  // ISO date or datetime
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, ambiguous: false };

  const tryDmyMdy = (order: "dmy" | "mdy"): string | null => {
    const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const fmt = format ?? "auto";
  if (fmt === "dmy") return { date: tryDmyMdy("dmy"), ambiguous: false };
  if (fmt === "mdy") return { date: tryDmyMdy("mdy"), ambiguous: false };
  if (fmt === "iso") return { date: null, ambiguous: false }; // already tried ISO above

  const dmy = tryDmyMdy("dmy");
  const mdy = tryDmyMdy("mdy");
  // 03/04/2025 is two different days depending on where the file came from,
  // and nothing in the row says which. Read it as D/M and say so.
  return { date: dmy ?? mdy, ambiguous: dmy !== null && mdy !== null && dmy !== mdy };
}

function validateMapping(
  mapping: ColumnMapping,
  headers: string[],
): { ok: true } | { ok: false; error: string } {
  const set = new Set(headers);
  for (const field of REQUIRED_COLUMNS) {
    const col = mapping[field];
    if (!col || !set.has(col)) {
      return { ok: false, error: `mapping.${field} must be a column in the CSV` };
    }
  }
  if (mapping.currency && !set.has(mapping.currency)) {
    return { ok: false, error: "mapping.currency is not a CSV column" };
  }
  if (!mapping.currency && !mapping.defaultCurrency) {
    return {
      ok: false,
      error: "Map a currency column, or set a default currency for the whole file",
    };
  }
  for (const opt of ["fee", "feeCurrency", "exchange", "name"] as const) {
    const col = mapping[opt];
    if (col && !set.has(col)) {
      return { ok: false, error: `mapping.${opt} is not a CSV column` };
    }
  }
  return { ok: true };
}

function emptyResult(warnings: string[]): ParseResult {
  return {
    transactions: [],
    skipped: [],
    instruments: [],
    warnings,
    summary: { buys: 0, sells: 0, dividends: 0, splits: 0, skipped: 0, newInstruments: 0 },
    priceMarks: [],
    customSettings: [],
  };
}

/**
 * Apply a column mapping to raw CSV text → ImportTransaction[] (+ instruments, skips).
 * No custom holdings / price marks — those stay Snowball-specific.
 */
export function parseGenericCsv(text: string, mapping: ColumnMapping): ParseResult {
  const { headers, data } = parseRows(text);
  const check = validateMapping(mapping, headers);
  if (!check.ok) return emptyResult([check.error]);

  const transactions: ImportTransaction[] = [];
  const skipped: SkippedRow[] = [];
  const instruments = new Map<string, ImportInstrument>();
  const warnings: string[] = [];
  const dateFormat = mapping.dateFormat ?? "auto";
  const defaultCcy = mapping.defaultCurrency?.trim().toUpperCase() || null;
  const defaultEx = mapping.defaultExchange?.trim() || "UNKNOWN";
  const typeAliases = mapping.typeAliases ?? {};

  let signedQuantities = 0;
  let ambiguousDates = 0;
  let ambiguousDateExample = "";

  data.forEach((row, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const symbol = cell(row, mapping.symbol).toUpperCase();
    const typeRaw = cell(row, mapping.type);
    const qtyRaw = cell(row, mapping.quantity);
    const priceRaw = cell(row, mapping.price);
    const ccyRaw = cell(row, mapping.currency).toUpperCase() || defaultCcy || "";
    const dateRaw = cell(row, mapping.tradeDate);
    const feeRaw = mapping.fee ? cell(row, mapping.fee) : "";
    const feeCcyRaw = mapping.feeCurrency ? cell(row, mapping.feeCurrency).toUpperCase() : "";
    const exchange = (mapping.exchange ? cell(row, mapping.exchange) : "") || defaultEx;
    const name = (mapping.name ? cell(row, mapping.name) : "") || symbol;

    if (!symbol && !typeRaw && !qtyRaw && !dateRaw) return;

    const typeRes = resolveType(typeRaw, typeAliases);
    if (!typeRes.ok) {
      skipped.push({
        row: rowNumber,
        symbol: symbol || "—",
        event: typeRaw || "—",
        reason: describeTypeFailure(typeRes),
      });
      return;
    }
    const type = typeRes.type;

    const dateRes = parseDate(dateRaw, dateFormat);
    if (!dateRes.date) {
      skipped.push({
        row: rowNumber,
        symbol: symbol || "—",
        event: type,
        reason: `Unreadable date "${dateRaw}"`,
      });
      return;
    }
    if (dateRes.ambiguous) {
      ambiguousDates += 1;
      if (!ambiguousDateExample) ambiguousDateExample = dateRaw;
    }
    const tradeDate = dateRes.date;

    if (!symbol) {
      skipped.push({ row: rowNumber, symbol: "—", event: type, reason: "Missing symbol" });
      return;
    }

    if (!/^[A-Z0-9._^-]{1,40}$/i.test(symbol)) {
      skipped.push({ row: rowNumber, symbol, event: type, reason: "Invalid symbol characters" });
      return;
    }

    const rawQuantity = parseNumber(qtyRaw);
    if (rawQuantity === null) {
      skipped.push({
        row: rowNumber,
        symbol,
        event: type,
        reason: qtyRaw ? `Unreadable quantity "${qtyRaw}"` : "Missing quantity",
      });
      return;
    }
    // Brokers signal direction two ways: a type column, or the sign on the
    // quantity. We have the type column, so the sign is redundant — dropping it
    // rescues every export that writes sells as negative.
    const signed = new Decimal(rawQuantity).isNegative();
    if (signed) signedQuantities += 1;
    const quantity = new Decimal(rawQuantity).abs().toFixed();

    let price = parseNumber(priceRaw);

    if (type === "split") {
      // Splits: quantity = ratio, price must be 0
      if (!new Decimal(quantity).greaterThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: "Split ratio must be greater than zero",
        });
        return;
      }
      price = "0";
    } else {
      if (!new Decimal(quantity).greaterThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: "Quantity must be greater than zero",
        });
        return;
      }
      if (price === null) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: priceRaw ? `Unreadable price "${priceRaw}"` : "Missing price",
        });
        return;
      }
      // Zero is legitimate — bonus shares, gifted stock, scrip dividends, and
      // the price-0 "buy" rows custom-income-sync emits for reinvested
      // income — only negative prices are nonsense. A sell written as a
      // negative cash amount lands here, hence the abs() on the quantity above
      // but not on this: a negative unit price is a mapping mistake.
      if (new Decimal(price).lessThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: `Price cannot be negative (got "${priceRaw}") — is this a cash amount rather than a unit price?`,
        });
        return;
      }
    }

    if (!ccyRaw || ccyRaw.length !== 3) {
      skipped.push({
        row: rowNumber,
        symbol,
        event: type,
        reason: ccyRaw
          ? `Currency must be a 3-letter code (got "${ccyRaw}")`
          : "Missing currency (map a column or set a default currency)",
      });
      return;
    }

    let fee: string | null = null;
    let feeCurrency: string | null = null;
    if (feeRaw) {
      const parsedFee = parseNumber(feeRaw);
      if (parsedFee === null) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: `Unreadable fee "${feeRaw}"`,
        });
        return;
      }
      // A fee's sign is presentational — exports write the same commission as
      // 1.00 or -1.00 depending on whether they think in cash flow. Sage stores
      // a cost.
      fee = new Decimal(parsedFee).abs().toFixed();
      feeCurrency = feeCcyRaw.length === 3 ? feeCcyRaw : ccyRaw;
    }

    transactions.push({
      symbol,
      type,
      quantity,
      price,
      currency: ccyRaw,
      tradeDate,
      fee,
      feeCurrency,
      exchange,
      rowNumber,
    });

    if (!instruments.has(symbol)) {
      instruments.set(symbol, {
        symbol,
        name: name || symbol,
        exchange,
        currency: ccyRaw,
        assetType: "stock",
      });
    }
  });

  if (transactions.length === 0 && skipped.length === 0) {
    warnings.push("No data rows found in the CSV.");
  }
  if (ambiguousDates > 0) {
    warnings.push(
      `${ambiguousDates} ${ambiguousDates === 1 ? "date is" : "dates are"} ambiguous ` +
        `(e.g. "${ambiguousDateExample}") and were read as day/month. ` +
        `Check the dates below, and set the date format explicitly if they are month/day.`,
    );
  }
  if (signedQuantities > 0) {
    warnings.push(
      `${signedQuantities} ${signedQuantities === 1 ? "row has a negative quantity" : "rows have negative quantities"}. ` +
        `The type column already says buy or sell, so the sign was dropped.`,
    );
  }
  if (!mapping.currency && defaultCcy) {
    warnings.push(`No currency column mapped — every row is treated as ${defaultCcy}.`);
  }

  return {
    transactions,
    skipped,
    instruments: [...instruments.values()],
    warnings,
    summary: {
      buys: transactions.filter((t) => t.type === "buy").length,
      sells: transactions.filter((t) => t.type === "sell").length,
      dividends: transactions.filter((t) => t.type === "dividend").length,
      splits: transactions.filter((t) => t.type === "split").length,
      skipped: skipped.length,
      newInstruments: instruments.size,
    },
    priceMarks: [],
    customSettings: [],
  };
}
