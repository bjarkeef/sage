import { Hono } from "hono";
import Papa from "papaparse";
import type { AppEnv } from "../middleware/session";
import type { Database } from "../db/client";
import {
  buildExport,
  buildTransactionRows,
  type ExportTransactionRow,
} from "../services/export-view";

/** Column order is part of the contract: the first six are the generic
 *  importer's required fields, the next four its optional ones, and `source`
 *  is ours — the importer ignores a column it was not mapped to. */
const CSV_COLUMNS: (keyof ExportTransactionRow)[] = [
  "symbol",
  "type",
  "quantity",
  "price",
  "currency",
  "tradeDate",
  "fee",
  "feeCurrency",
  "exchange",
  "name",
  "source",
];

/** `sage-transactions-2026-08-10.csv` — dated so successive downloads do not
 *  overwrite each other in the browser's download folder. */
function filename(prefix: string, ext: string, now: Date): string {
  return `sage-${prefix}-${now.toISOString().slice(0, 10)}.${ext}`;
}

/**
 * Read-only data export. Makes no provider calls, so it still works during the
 * kind of upstream outage that makes someone want their data out — and applies
 * no FX conversion, so amounts stay in the currency they were entered in.
 */
export function exportRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/transactions.csv", async (c) => {
    const rows = await buildTransactionRows(db, c.get("user").id);
    // Object form so the header still prints on an empty portfolio — the
    // (data, config) form Papa.unparse used before short-circuits to "" on an
    // empty array and never consults `columns`, leaving a fresh self-hoster
    // with a 0-byte file that Sage's own importer then rejects.
    const csv = Papa.unparse({ fields: CSV_COLUMNS, data: rows }, { newline: "\n" });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${filename("transactions", "csv", new Date())}"`,
    );
    return c.body(csv);
  });

  app.get("/data.json", async (c) => {
    const doc = await buildExport(db, c.get("user").id);
    c.header("Content-Type", "application/json; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${filename("export", "json", new Date())}"`,
    );
    return c.body(JSON.stringify(doc, null, 2));
  });

  return app;
}
