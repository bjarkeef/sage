import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { instrument } from "../db/schema";

/**
 * Resolve an asset route slug to a symbol.
 *
 * The slug is either `SYMBOL` or `EXCHANGE-SYMBOL`, and the app emits both:
 * `holding-row.tsx` prefixes the exchange, while the dividend list, the
 * calendar and the category browser all link the bare symbol.
 *
 * Splitting on the first dash to strip that prefix is wrong, because a dash
 * does not imply a prefix — Nordic share classes carry one inside the symbol
 * itself (`NORDLAS-B.ST`, `ZED-B.US`). Those collapsed to just the share-class
 * segment and 404'd from every bare-symbol link in the app.
 *
 * So the whole slug wins whenever it names an instrument we already know, and
 * only a slug that does not is treated as prefixed. A slug with no dash cannot
 * be ambiguous and never reaches the database.
 */
export async function resolveAssetSlug(db: Database, slug: string): Promise<string> {
  const dashIdx = slug.indexOf("-");
  if (dashIdx < 0) return slug;

  const [known] = await db
    .select({ symbol: instrument.symbol })
    .from(instrument)
    .where(eq(instrument.symbol, slug))
    .limit(1);

  return known ? slug : slug.slice(dashIdx + 1);
}
