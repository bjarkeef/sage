import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  Decimal,
  Money,
  computePositions,
  OversellError,
  type PositionTransaction,
} from "@sage/core";
import type { AppEnv } from "../middleware/session";
import type { IMarketDataProvider } from "@sage/provider-interface";
import type { Database } from "../db/client";
import { instrument, customHolding, manualPrice, assetProfile, transaction } from "../db/schema";
import { getUserPortfolio } from "../auth";
import { syncAllPositionDividends } from "../market-data/dividend-sync";
import { syncCustomIncome } from "../services/custom-income-sync";
import { invalidateReconciliation } from "../services/dividend-reconciliation";
import { parseSnowballCSV, isSnowballCsv } from "../import/snowball-parser";
import { inspectCsv, parseGenericCsv, type ColumnMapping } from "../import/generic-csv";
import { planImport, executeImport, type PlannedRow } from "../import/dedupe";
import type { ImportInstrument, ParseResult } from "../import/types";
import type { IsinResolver } from "../market-data/isin-resolver";
import { backfillProfiles } from "../market-data/asset-profile-cache";
import { ensureInstrument } from "../lib/ensure-instrument";
import { toPositionTransaction } from "../lib/to-position-transaction";
import { z } from "zod";

/** ~10 MB — generous for a multi-year broker export, small enough for API RAM. */
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

async function assertImportLedger(
  db: Database,
  portfolioId: string,
  plan: PlannedRow[],
  restoreDeleted: boolean,
): Promise<{ ok: true } | { ok: false; symbol: string }> {
  const existing = await db
    .select()
    .from(transaction)
    .where(eq(transaction.portfolioId, portfolioId));
  const simulated: PositionTransaction[] = existing.map((r) => toPositionTransaction(r));
  for (const row of plan) {
    const willInsert =
      row.disposition === "insert" || (row.disposition === "tombstoned" && restoreDeleted);
    if (!willInsert) continue;
    simulated.push({
      symbol: row.tx.symbol,
      type: row.tx.type,
      quantity: new Decimal(row.tx.quantity),
      price: Money.of(row.tx.price, row.tx.currency),
      tradeDate: new Date(`${row.tx.tradeDate}T00:00:00Z`),
      sequence: `import|${String(row.tx.rowNumber).padStart(8, "0")}|${row.occurrence}`,
    });
  }
  try {
    computePositions(simulated);
    return { ok: true };
  } catch (err) {
    if (err instanceof OversellError) return { ok: false, symbol: err.symbol };
    throw err;
  }
}

async function newInstrumentsOf(
  db: Database,
  parsed: ImportInstrument[],
): Promise<ImportInstrument[]> {
  const existing = await db.select({ symbol: instrument.symbol }).from(instrument);
  const existingSet = new Set(existing.map((r) => r.symbol));
  return parsed.filter((i) => !existingSet.has(i.symbol));
}

/** parsed.instruments only covers symbols that appear on a transaction row.
 *  A CUSTOM_HOLDING_SETTINGS or CUSTOM_HOLDING_PRICE row can reference a
 *  symbol with no transactions in this file (a fully-exited holding, or a
 *  settings-only re-export) — that symbol still needs an instrument row. */
function instrumentsIncludingCustom(parsed: ParseResult): ImportInstrument[] {
  const map = new Map(parsed.instruments.map((i) => [i.symbol, i]));
  for (const s of parsed.customSettings) {
    if (!map.has(s.symbol)) {
      map.set(s.symbol, {
        symbol: s.symbol,
        name: s.symbol,
        exchange: "CUSTOM",
        currency: s.currency,
        assetType: "custom",
      });
    }
  }
  for (const m of parsed.priceMarks) {
    if (!map.has(m.symbol)) {
      map.set(m.symbol, {
        symbol: m.symbol,
        name: m.symbol,
        exchange: "CUSTOM",
        currency: m.currency,
        assetType: "custom",
      });
    }
  }
  return Array.from(map.values());
}

function duplicateSkipsOf(plan: PlannedRow[]) {
  return plan
    .filter(
      (r) =>
        r.disposition === "already-imported" ||
        r.disposition === "claim-existing" ||
        r.disposition === "adopt-auto" ||
        r.disposition === "adopt-custom-income",
    )
    .map((r) => ({
      row: r.tx.rowNumber,
      symbol: r.tx.symbol,
      event: r.tx.type,
      reason:
        r.disposition === "already-imported"
          ? "Already imported"
          : r.disposition === "adopt-auto"
            ? "Updates an auto-added dividend"
            : r.disposition === "adopt-custom-income"
              ? "Updates a generated income payment"
              : "Matches existing transaction",
    }));
}

const columnMappingSchema = z.object({
  symbol: z.string().min(1),
  type: z.string().min(1),
  quantity: z.string().min(1),
  price: z.string().min(1),
  // Optional: a single-currency broker omits the column, and defaultCurrency
  // stands in for the whole file. parseGenericCsv rejects the case where
  // neither is given.
  currency: z.string().nullish(),
  tradeDate: z.string().min(1),
  fee: z.string().nullish(),
  feeCurrency: z.string().nullish(),
  exchange: z.string().nullish(),
  name: z.string().nullish(),
  defaultCurrency: z.string().length(3).nullish(),
  defaultExchange: z.string().nullish(),
  typeAliases: z.record(z.string(), z.enum(["buy", "sell", "dividend", "split"])).nullish(),
  dateFormat: z.enum(["iso", "dmy", "mdy", "auto"]).optional(),
});

async function previewFromParsed(db: Database, portfolioId: string, parsed: ParseResult) {
  const plan = await planImport(db, portfolioId, parsed.transactions);
  const inserts = plan.filter((r) => r.disposition === "insert").map((r) => r.tx);
  const deleted = plan.filter((r) => r.disposition === "tombstoned").map((r) => r.tx);
  const skipped = [...parsed.skipped, ...duplicateSkipsOf(plan)];
  const newInstruments = await newInstrumentsOf(db, instrumentsIncludingCustom(parsed));
  return {
    transactions: inserts,
    deleted,
    skipped,
    instruments: newInstruments,
    warnings: parsed.warnings,
    summary: {
      buys: inserts.filter((t) => t.type === "buy").length,
      sells: inserts.filter((t) => t.type === "sell").length,
      dividends: inserts.filter((t) => t.type === "dividend").length,
      splits: inserts.filter((t) => t.type === "split").length,
      skipped: skipped.length,
      deleted: deleted.length,
      newInstruments: newInstruments.length,
      customHoldings: parsed.customSettings.length,
      priceMarks: parsed.priceMarks.length,
    },
  };
}

/**
 * A file this route must not parse, because a dedicated parser reads meaning
 * the column mapping cannot.
 *
 * The mapping UI can find plausible columns in a Snowball export — `Symbol`,
 * `Price`, `Quantity` all look ordinary — and produce silent corruption: the
 * exchange lives in its own column, so `KOBANK`/`CO` imports as a bare
 * `KOBANK` that duplicates the existing `KOBANK.CO`, and a dividend's
 * `Price` is per share against a `Quantity` holding the total amount, so rows
 * land at the wrong size or, where Snowball writes `Price=0`, at no value at
 * all. None of that fails loudly, so the guard is here and not just in the UI.
 */
function detectWrongImporter(
  text: string,
): { error: "wrong_importer"; detectedFormat: "snowball"; message: string } | null {
  if (!isSnowballCsv(text)) return null;
  return {
    error: "wrong_importer",
    detectedFormat: "snowball",
    message:
      "This is a Snowball Analytics export. Import it with the Snowball option, " +
      "which reads its exchange column and dividend amounts correctly.",
  };
}

/**
 * Fetch dividend history for the symbols an import touched, then release the
 * reconciliation claim so the next read turns that history into received
 * dividends. Fire-and-forget: the import has already succeeded. The claim is
 * released even when the sync fails part-way, since whatever it did write
 * still needs reconciling.
 */
function syncThenReconcile(
  db: Database,
  provider: IMarketDataProvider,
  portfolioId: string,
  symbols: string[],
): void {
  syncAllPositionDividends(db, [provider], symbols)
    .catch((err: unknown) => {
      console.warn("post-import dividend sync failed:", err instanceof Error ? err.message : err);
    })
    .then(() => invalidateReconciliation(db, portfolioId))
    .catch((err: unknown) => {
      console.warn(
        "post-import reconciliation reset failed:",
        err instanceof Error ? err.message : err,
      );
    });
}

export function importRoutes(
  db: Database,
  provider?: IMarketDataProvider,
  isinResolver?: IsinResolver,
) {
  const app = new Hono<AppEnv>();

  app.post("/snowball/preview", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: "file_too_large", maxBytes: MAX_IMPORT_BYTES }, 413);
    }

    const parsed = parseSnowballCSV(await file.text());
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const plan = await planImport(db, portfolioId, parsed.transactions);

    const inserts = plan.filter((r) => r.disposition === "insert").map((r) => r.tx);
    const deleted = plan.filter((r) => r.disposition === "tombstoned").map((r) => r.tx);
    const skipped = [...parsed.skipped, ...duplicateSkipsOf(plan)];
    const newInstruments = await newInstrumentsOf(db, instrumentsIncludingCustom(parsed));

    return c.json({
      transactions: inserts,
      deleted,
      skipped,
      instruments: newInstruments,
      warnings: parsed.warnings,
      summary: {
        buys: inserts.filter((t) => t.type === "buy").length,
        sells: inserts.filter((t) => t.type === "sell").length,
        dividends: inserts.filter((t) => t.type === "dividend").length,
        splits: inserts.filter((t) => t.type === "split").length,
        skipped: skipped.length,
        deleted: deleted.length,
        newInstruments: newInstruments.length,
        customHoldings: parsed.customSettings.length,
        priceMarks: parsed.priceMarks.length,
      },
    });
  });

  app.post("/snowball/commit", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: "file_too_large", maxBytes: MAX_IMPORT_BYTES }, 413);
    }
    const restoreDeleted = body["restoreDeleted"] === "true";

    const parsed = parseSnowballCSV(await file.text());
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);

    // Instruments first, so transaction FKs have targets. Includes symbols
    // that only appear in a settings/mark row (see instrumentsIncludingCustom).
    // Shared catalog: never overwrite currency/assetType for an existing symbol
    // (multi-tenant / hosted isolation).
    const newInstruments = await newInstrumentsOf(db, instrumentsIncludingCustom(parsed));
    for (const inst of newInstruments) {
      await ensureInstrument(db, {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        currency: inst.currency,
        assetType: inst.assetType as "stock" | "etf" | "fund" | "index" | "other" | "custom",
      });
    }

    // Custom holdings are portfolio-owned. A symbol is globally unique today
    // (instrument PK); refuse to take over another portfolio's custom row so
    // hosted multi-tenant imports cannot clobber each other.
    const customHoldingConflicts: string[] = [];
    let customHoldingsApplied = 0;
    for (const s of parsed.customSettings) {
      const [owner] = await db
        .select({ portfolioId: customHolding.portfolioId })
        .from(customHolding)
        .where(eq(customHolding.symbol, s.symbol))
        .limit(1);
      if (owner && owner.portfolioId !== portfolioId) {
        customHoldingConflicts.push(s.symbol);
        continue;
      }

      if (owner) {
        await db
          .update(customHolding)
          .set({
            holdingType: s.holdingType,
            sector: s.sector,
            note: s.note,
            incomeEnabled: s.incomeEnabled,
            incomeYearlyPct: s.incomeYearlyPct,
            frequencyUnit: s.frequencyUnit,
            frequencyInterval: s.frequencyInterval,
            firstPaymentDate: s.firstPaymentDate,
            lastPaymentDate: s.lastPaymentDate,
            autoAdd: s.autoAdd,
            reinvest: s.reinvest,
          })
          .where(
            and(eq(customHolding.symbol, s.symbol), eq(customHolding.portfolioId, portfolioId)),
          );
      } else {
        await db.insert(customHolding).values({
          symbol: s.symbol,
          portfolioId,
          holdingType: s.holdingType,
          sector: s.sector,
          note: s.note,
          incomeEnabled: s.incomeEnabled,
          incomeYearlyPct: s.incomeYearlyPct,
          frequencyUnit: s.frequencyUnit,
          frequencyInterval: s.frequencyInterval,
          firstPaymentDate: s.firstPaymentDate,
          lastPaymentDate: s.lastPaymentDate,
          autoAdd: s.autoAdd,
          reinvest: s.reinvest,
        });
      }
      customHoldingsApplied += 1;

      if (s.name) {
        await db.update(instrument).set({ name: s.name }).where(eq(instrument.symbol, s.symbol));
      }

      // Mirror into asset_profile so sector-based views that read the cache
      // table directly (e.g. diversification) see this data immediately,
      // instead of waiting for an asset-page visit to warm the provider cache.
      // assetType is "other" (AssetProfile's AssetType has no "custom" value —
      // see manual-price-provider.ts's getAssetProfile for the same mapping).
      // Notes stay off the shared profile (portfolio-private via /custom-holdings).
      const profileName = s.name ?? s.symbol;
      const profileRow = {
        symbol: s.symbol,
        name: profileName,
        exchange: "CUSTOM",
        assetType: "other",
        currency: s.currency,
        sector: s.sector,
        fetchedAt: new Date(),
      };
      await db
        .insert(assetProfile)
        .values(profileRow)
        .onConflictDoUpdate({ target: assetProfile.symbol, set: profileRow });
    }

    let priceMarksApplied = 0;
    for (const m of parsed.priceMarks) {
      const [owner] = await db
        .select({ portfolioId: customHolding.portfolioId })
        .from(customHolding)
        .where(eq(customHolding.symbol, m.symbol))
        .limit(1);
      // Only write marks for symbols this portfolio owns (or brand-new customs
      // that just landed above). Never overwrite another tenant's price series.
      if (owner && owner.portfolioId !== portfolioId) continue;

      await db
        .insert(manualPrice)
        .values({ symbol: m.symbol, date: m.date, price: m.price, currency: m.currency })
        .onConflictDoUpdate({
          target: [manualPrice.symbol, manualPrice.date],
          set: { price: m.price, currency: m.currency },
        });
      priceMarksApplied += 1;
    }

    const plan = await planImport(db, portfolioId, parsed.transactions);
    const ledgerCheck = await assertImportLedger(db, portfolioId, plan, restoreDeleted);
    if (!ledgerCheck.ok) {
      return c.json({ error: "oversell", symbol: ledgerCheck.symbol }, 400);
    }
    const result = await executeImport(db, portfolioId, "snowball", plan, { restoreDeleted });

    if (provider && result.syncSymbols.length > 0) {
      syncThenReconcile(db, provider, portfolioId, result.syncSymbols);
    }
    if (isinResolver) {
      // Custom symbols have no ISIN to resolve — Snowball's own identity.
      const customSyms = new Set(
        instrumentsIncludingCustom(parsed)
          .filter((i) => i.assetType === "custom")
          .map((i) => i.symbol),
      );
      for (const sym of result.syncSymbols) {
        if (customSyms.has(sym)) continue;
        isinResolver.resolveAndStore(db, sym).catch(() => {});
      }
    }

    const response = {
      inserted: result.inserted,
      restored: result.restored,
      claimedExisting: result.claimed,
      adoptedAuto: result.adopted,
      skippedDuplicates: result.alreadyImported + result.tombstonedSkipped,
      instrumentsCreated: newInstruments.length,
      customHoldings: customHoldingsApplied,
      priceMarks: priceMarksApplied,
      customHoldingConflicts,
    };

    // Materialize any due custom-income payments now that settings/marks have
    // landed. Fire-and-forget: never block the response on it, and a failure
    // here must not fail an import that already succeeded.
    syncCustomIncome(db, c.get("user").id).catch((err) => {
      console.warn(
        "post-import custom income sync failed:",
        err instanceof Error ? err.message : err,
      );
    });

    // Fetch the profiles for symbols this import introduced. Sector, country
    // and the real company name all live in `asset_profile`, and until this
    // existed the only thing that ever wrote that table was someone opening an
    // asset page — so an imported book read `Unknown` across Diversification,
    // and `MSFT / MSFT` in the holdings list, until every holding had been
    // visited by hand. Fire-and-forget, like the sync above: the import has
    // already succeeded and must not fail on a provider hiccup.
    if (provider && newInstruments.length > 0) {
      backfillProfiles(
        db,
        provider,
        newInstruments.map((i) => i.symbol),
      ).catch((err: unknown) => {
        console.warn(
          "post-import profile backfill failed:",
          err instanceof Error ? err.message : err,
        );
      });
    }

    return c.json(response);
  });

  // --- Generic CSV (column mapping) -----------------------------------------

  app.post("/csv/inspect", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: "file_too_large", maxBytes: MAX_IMPORT_BYTES }, 413);
    }
    return c.json(inspectCsv(await file.text()));
  });

  app.post("/csv/preview", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: "file_too_large", maxBytes: MAX_IMPORT_BYTES }, 413);
    }
    const mappingRaw = body["mapping"];
    if (typeof mappingRaw !== "string") {
      return c.json({ error: "missing_mapping" }, 400);
    }
    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(mappingRaw);
    } catch {
      return c.json({ error: "invalid_mapping_json" }, 400);
    }
    const mappingParsed = columnMappingSchema.safeParse(mappingJson);
    if (!mappingParsed.success) {
      return c.json({ error: "invalid_mapping", issues: mappingParsed.error.issues }, 400);
    }
    const mapping: ColumnMapping = mappingParsed.data;
    const text = await file.text();
    const wrongImporter = detectWrongImporter(text);
    if (wrongImporter) return c.json(wrongImporter, 409);
    const parsed = parseGenericCsv(text, mapping);
    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    return c.json(await previewFromParsed(db, portfolioId, parsed));
  });

  app.post("/csv/commit", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return c.json({ error: "file_too_large", maxBytes: MAX_IMPORT_BYTES }, 413);
    }
    const restoreDeleted = body["restoreDeleted"] === "true";
    const mappingRaw = body["mapping"];
    if (typeof mappingRaw !== "string") {
      return c.json({ error: "missing_mapping" }, 400);
    }
    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(mappingRaw);
    } catch {
      return c.json({ error: "invalid_mapping_json" }, 400);
    }
    const mappingParsed = columnMappingSchema.safeParse(mappingJson);
    if (!mappingParsed.success) {
      return c.json({ error: "invalid_mapping", issues: mappingParsed.error.issues }, 400);
    }
    const mapping: ColumnMapping = mappingParsed.data;
    const text = await file.text();
    const wrongImporter = detectWrongImporter(text);
    if (wrongImporter) return c.json(wrongImporter, 409);
    const parsed = parseGenericCsv(text, mapping);
    if (parsed.transactions.length === 0 && parsed.warnings.length > 0) {
      return c.json({ error: "empty_import", warnings: parsed.warnings }, 400);
    }

    const { id: portfolioId } = await getUserPortfolio(db, c.get("user").id);
    const newInstruments = await newInstrumentsOf(db, parsed.instruments);
    for (const inst of newInstruments) {
      await ensureInstrument(db, {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        currency: inst.currency,
        assetType: inst.assetType as "stock" | "etf" | "fund" | "index" | "other" | "custom",
      });
    }

    const plan = await planImport(db, portfolioId, parsed.transactions);
    const ledgerCheck = await assertImportLedger(db, portfolioId, plan, restoreDeleted);
    if (!ledgerCheck.ok) {
      return c.json({ error: "oversell", symbol: ledgerCheck.symbol }, 400);
    }
    const result = await executeImport(db, portfolioId, "csv", plan, { restoreDeleted });

    if (provider && result.syncSymbols.length > 0) {
      syncThenReconcile(db, provider, portfolioId, result.syncSymbols);
    }
    if (isinResolver) {
      for (const sym of result.syncSymbols) {
        isinResolver.resolveAndStore(db, sym).catch(() => {});
      }
    }

    // Fetch the profiles for symbols this import introduced. Sector, country
    // and the real company name all live in `asset_profile`, and until this
    // existed the only thing that ever wrote that table was someone opening an
    // asset page — so an imported book read `Unknown` across Diversification,
    // and `MSFT / MSFT` in the holdings list, until every holding had been
    // visited by hand. Fire-and-forget, like the sync above: the import has
    // already succeeded and must not fail on a provider hiccup.
    if (provider && newInstruments.length > 0) {
      backfillProfiles(
        db,
        provider,
        newInstruments.map((i) => i.symbol),
      ).catch((err: unknown) => {
        console.warn(
          "post-import profile backfill failed:",
          err instanceof Error ? err.message : err,
        );
      });
    }

    return c.json({
      inserted: result.inserted,
      restored: result.restored,
      claimedExisting: result.claimed,
      adoptedAuto: result.adopted,
      skippedDuplicates: result.alreadyImported + result.tombstonedSkipped,
      instrumentsCreated: newInstruments.length,
    });
  });

  return app;
}
