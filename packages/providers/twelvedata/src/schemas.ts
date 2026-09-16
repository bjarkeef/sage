import { z } from "zod";
import { ProviderUnavailableError } from "@sage/provider-interface";

/** Twelve Data sends prices as decimal strings; keep them as strings so no
 *  float ever touches a money value. */
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const quoteSchema = z.object({
  symbol: z.string(),
  exchange: z.string(),
  mic_code: z.string().optional(),
  currency: z.string(),
  timestamp: z.number(),
  last_quote_at: z.number().optional(),
  close: decimalString,
  previous_close: decimalString.optional(),
  fifty_two_week: z
    .object({ low: decimalString.optional(), high: decimalString.optional() })
    .optional(),
});

export const timeSeriesSchema = z.object({
  meta: z.object({ symbol: z.string(), currency: z.string() }),
  values: z.array(
    z.object({
      datetime: z.string(),
      open: decimalString,
      high: decimalString,
      low: decimalString,
      close: decimalString,
      volume: decimalString.optional(),
    }),
  ),
});

export const dividendsSchema = z.object({
  meta: z.object({ currency: z.string() }),
  dividends: z.array(z.object({ ex_date: z.string(), amount: z.number() })),
});

const optionalText = z.string().nullish();

export const profileSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  sector: optionalText,
  industry: optionalText,
  employees: z.number().nullish(),
  website: optionalText,
  description: optionalText,
  type: optionalText,
  CEO: optionalText,
  country: optionalText,
});

export const searchSchema = z.object({
  data: z.array(
    z.object({
      symbol: z.string(),
      instrument_name: z.string(),
      exchange: z.string(),
      mic_code: z.string(),
      currency: z.string(),
      instrument_type: z.string().optional(),
    }),
  ),
});

export type TdQuote = z.infer<typeof quoteSchema>;
export type TdTimeSeries = z.infer<typeof timeSeriesSchema>;
export type TdDividends = z.infer<typeof dividendsSchema>;
export type TdProfile = z.infer<typeof profileSchema>;
export type TdSearch = z.infer<typeof searchSchema>;

export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ProviderUnavailableError("Twelve Data returned an unexpected response shape", {
      cause: result.error,
    });
  }
  return result.data;
}
