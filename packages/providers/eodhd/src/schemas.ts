import { z } from "zod";
import { ProviderUnavailableError } from "@sage/provider-interface";

export const eodBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  adjusted_close: z.number(),
  volume: z.number(),
});

export const eodResponseSchema = z.array(eodBarSchema);

export const realTimeSchema = z.object({
  code: z.string(),
  timestamp: z.number(),
  gmtoffset: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  previousClose: z.number().optional(),
});

export const dividendItemSchema = z.object({
  date: z.string(),
  value: z.number(),
  currency: z.string().optional(),
  declarationDate: z.string().nullable().optional(),
  recordDate: z.string().nullable().optional(),
  paymentDate: z.string().nullable().optional(),
  period: z.string().nullable().optional(),
  unadjustedValue: z.number().optional(),
});

export const dividendResponseSchema = z.array(dividendItemSchema);

export const searchResultSchema = z.object({
  Code: z.string(),
  Exchange: z.string(),
  Name: z.string(),
  Type: z.string(),
  Country: z.string(),
  Currency: z.string(),
  ISIN: z.string().nullable().optional(),
  previousClose: z.number().nullable().optional(),
  previousCloseDate: z.string().nullable().optional(),
});

export const searchResponseSchema = z.array(searchResultSchema);

const fundamentalsGeneralSchema = z.object({
  Code: z.string(),
  Type: z.string().optional(),
  Name: z.string(),
  Exchange: z.string(),
  CurrencyCode: z.string(),
  CountryName: z.string().optional(),
  CountryISO: z.string().optional(),
  Sector: z.string().nullable().optional(),
  Industry: z.string().nullable().optional(),
  GicSector: z.string().nullable().optional(),
  GicGroup: z.string().nullable().optional(),
  Description: z.string().nullable().optional(),
  WebURL: z.string().nullable().optional(),
  IPODate: z.string().nullable().optional(),
  FullTimeEmployees: z.number().nullable().optional(),
  Officers: z
    .record(
      z.object({
        Name: z.string().optional(),
        Title: z.string().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const fundamentalsHighlightsSchema = z
  .object({
    MarketCapitalization: z.number().nullable().optional(),
    PERatio: z.number().nullable().optional(),
    DividendYield: z.number().nullable().optional(),
    EarningsShare: z.number().nullable().optional(),
  })
  .passthrough();

const fundamentalsTechnicalsSchema = z
  .object({
    Beta: z.number().nullable().optional(),
    "52WeekHigh": z.number().nullable().optional(),
    "52WeekLow": z.number().nullable().optional(),
  })
  .passthrough();

export const fundamentalsResponseSchema = z
  .object({
    General: fundamentalsGeneralSchema,
    Highlights: fundamentalsHighlightsSchema.optional(),
    Technicals: fundamentalsTechnicalsSchema.optional(),
    SplitsDividends: z
      .object({
        ForwardAnnualDividendRate: z.number().nullable().optional(),
        ForwardAnnualDividendYield: z.number().nullable().optional(),
        TrailingAnnualDividendRate: z.number().nullable().optional(),
        TrailingAnnualDividendYield: z.number().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type EodBar = z.infer<typeof eodBarSchema>;
export type RealTimeQuote = z.infer<typeof realTimeSchema>;
export type DividendItem = z.infer<typeof dividendItemSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type FundamentalsResponse = z.infer<typeof fundamentalsResponseSchema>;

/** Validate a raw payload, surfacing a shape mismatch as ProviderUnavailableError. */
export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ProviderUnavailableError("EODHD returned an unexpected response shape", {
      cause: result.error,
    });
  }
  return result.data;
}
