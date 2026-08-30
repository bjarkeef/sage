import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { instrument } from "../db/schema";

export type InstrumentInput = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: "stock" | "etf" | "fund" | "index" | "other" | "custom";
};

/**
 * Insert a shared catalog row, or refresh display fields only.
 * Never overwrites currency once set — multi-tenant hosted instances share
 * the instrument table, and a wrong currency breaks money math for everyone.
 */
export async function ensureInstrument(db: Database, input: InstrumentInput): Promise<void> {
  const [existing] = await db
    .select({ currency: instrument.currency })
    .from(instrument)
    .where(eq(instrument.symbol, input.symbol))
    .limit(1);

  if (!existing) {
    await db.insert(instrument).values({
      symbol: input.symbol,
      name: input.name,
      exchange: input.exchange,
      currency: input.currency,
      assetType: input.assetType === "custom" ? "custom" : input.assetType,
    });
    return;
  }

  // Display metadata only — currency and assetType stay provider/first-write.
  await db
    .update(instrument)
    .set({
      name: input.name,
      exchange: input.exchange,
    })
    .where(eq(instrument.symbol, input.symbol));
}
