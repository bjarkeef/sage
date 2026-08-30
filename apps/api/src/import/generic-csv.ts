import Papa from "papaparse";
import { Decimal } from "@sage/core";
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
  currency: string;
  tradeDate: string;
  fee?: string | null;
  feeCurrency?: string | null;
  exchange?: string | null;
  name?: string | null;
  /** When currency column is empty, use this (e.g. "EUR"). */
  defaultCurrency?: string | null;
  defaultExchange?: string | null;
  /**
   * How to read tradeDate cells.
   * - iso: YYYY-MM-DD (also accepts Date objects / ISO datetime)
   * - dmy: DD/MM/YYYY or DD.MM.YYYY
   * - mdy: MM/DD/YYYY
   * - auto: try iso, then dmy, then mdy
   */
  dateFormat?: "iso" | "dmy" | "mdy" | "auto";
}

export interface CsvInspectResult {
  headers: string[];
  /** First few data rows as objects keyed by header. */
  sampleRows: Record<string, string>[];
  rowCount: number;
  /** Best-effort guess for mapping; null fields when no confident match. */
  suggestedMapping: Partial<ColumnMapping>;
}

const REQUIRED_FIELDS = ["symbol", "type", "quantity", "price", "currency", "tradeDate"] as const;

const HEADER_ALIASES: Record<
  (typeof REQUIRED_FIELDS)[number] | "fee" | "feeCurrency" | "exchange" | "name",
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

const TYPE_ALIASES: Record<ImportTransactionType, string[]> = {
  buy: ["buy", "b", "purchase", "bought", "kauf"],
  sell: ["sell", "s", "sale", "sold", "verkauf"],
  dividend: ["dividend", "div", "dividende", "distribution"],
  split: ["split", "stock split", "aktien-split"],
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
    currency: pick(HEADER_ALIASES.currency),
    tradeDate: pick(HEADER_ALIASES.tradeDate),
    fee: pick(HEADER_ALIASES.fee) ?? null,
    feeCurrency: pick(HEADER_ALIASES.feeCurrency) ?? null,
    exchange: pick(HEADER_ALIASES.exchange) ?? null,
    name: pick(HEADER_ALIASES.name) ?? null,
    dateFormat: "auto",
  };
  return suggested;
}

export function inspectCsv(text: string): CsvInspectResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields?.filter((h) => h && h.length > 0) ?? [];
  const data = (parsed.data ?? []).filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== ""),
  );
  return {
    headers,
    sampleRows: data.slice(0, 8).map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = cell(r, h);
      return out;
    }),
    rowCount: data.length,
    suggestedMapping: suggestMapping(headers),
  };
}

function parseDate(raw: string, format: ColumnMapping["dateFormat"]): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO date or datetime
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

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
  if (fmt === "dmy") return tryDmyMdy("dmy");
  if (fmt === "mdy") return tryDmyMdy("mdy");
  if (fmt === "iso") return null; // already tried ISO above
  // auto
  return tryDmyMdy("dmy") ?? tryDmyMdy("mdy");
}

function parseType(raw: string): ImportTransactionType | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES) as [
    ImportTransactionType,
    string[],
  ][]) {
    if (aliases.includes(t)) return type;
  }
  return null;
}

function parseDecimal(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  try {
    const d = new Decimal(s);
    if (!d.isFinite()) return null;
    return d.toFixed();
  } catch {
    return null;
  }
}

function validateMapping(
  mapping: ColumnMapping,
  headers: string[],
): { ok: true } | { ok: false; error: string } {
  const set = new Set(headers);
  for (const field of REQUIRED_FIELDS) {
    const col = mapping[field];
    if (!col || !set.has(col)) {
      return { ok: false, error: `mapping.${field} must be a column in the CSV` };
    }
  }
  for (const opt of ["fee", "feeCurrency", "exchange", "name"] as const) {
    const col = mapping[opt];
    if (col && !set.has(col)) {
      return { ok: false, error: `mapping.${opt} is not a CSV column` };
    }
  }
  return { ok: true };
}

/**
 * Apply a column mapping to raw CSV text → ImportTransaction[] (+ instruments, skips).
 * No custom holdings / price marks — those stay Snowball-specific.
 */
export function parseGenericCsv(text: string, mapping: ColumnMapping): ParseResult {
  const inspected = inspectCsv(text);
  const check = validateMapping(mapping, inspected.headers);
  if (!check.ok) {
    return {
      transactions: [],
      skipped: [],
      instruments: [],
      warnings: [check.error],
      summary: {
        buys: 0,
        sells: 0,
        dividends: 0,
        splits: 0,
        skipped: 0,
        newInstruments: 0,
      },
      priceMarks: [],
      customSettings: [],
    };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const data = (parsed.data ?? []).filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== ""),
  );

  const transactions: ImportTransaction[] = [];
  const skipped: SkippedRow[] = [];
  const instruments = new Map<string, ImportInstrument>();
  const warnings: string[] = [];
  const dateFormat = mapping.dateFormat ?? "auto";
  const defaultCcy = mapping.defaultCurrency?.trim().toUpperCase() || null;
  const defaultEx = mapping.defaultExchange?.trim() || "UNKNOWN";

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

    const type = parseType(typeRaw);
    if (!type) {
      skipped.push({
        row: rowNumber,
        symbol: symbol || "—",
        event: typeRaw || "—",
        reason: `Unknown transaction type "${typeRaw}"`,
      });
      return;
    }

    const tradeDate = parseDate(dateRaw, dateFormat);
    if (!tradeDate) {
      skipped.push({
        row: rowNumber,
        symbol: symbol || "—",
        event: type,
        reason: `Unparseable date "${dateRaw}"`,
      });
      return;
    }

    if (!symbol) {
      skipped.push({
        row: rowNumber,
        symbol: "—",
        event: type,
        reason: "Missing symbol",
      });
      return;
    }

    if (!/^[A-Z0-9._^-]{1,40}$/i.test(symbol)) {
      skipped.push({
        row: rowNumber,
        symbol,
        event: type,
        reason: "Invalid symbol characters",
      });
      return;
    }

    const quantity = parseDecimal(qtyRaw);
    let price = parseDecimal(priceRaw);

    if (type === "split") {
      // Splits: quantity = ratio, price must be 0
      if (!quantity || !new Decimal(quantity).greaterThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: "Split ratio must be a positive number",
        });
        return;
      }
      price = "0";
    } else {
      if (!quantity || !new Decimal(quantity).greaterThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: "Quantity must be a positive number",
        });
        return;
      }
      // Zero is legitimate — bonus shares, gifted stock, scrip dividends, and
      // the price-0 "buy" rows custom-income-sync emits for reinvested
      // income — only negative prices are nonsense.
      if (!price || new Decimal(price).lessThan(0)) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: "Price cannot be negative",
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
          : "Missing currency (map a column or set defaultCurrency)",
      });
      return;
    }

    let fee: string | null = null;
    let feeCurrency: string | null = null;
    if (feeRaw) {
      fee = parseDecimal(feeRaw);
      if (!fee) {
        skipped.push({
          row: rowNumber,
          symbol,
          event: type,
          reason: `Unparseable fee "${feeRaw}"`,
        });
        return;
      }
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
