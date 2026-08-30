import { pgTable, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { FundHolding, SectorWeight } from "@sage/provider-interface";
import { instrument } from "./instrument";

export const assetProfile = pgTable("asset_profile", {
  symbol: text("symbol")
    .primaryKey()
    .references(() => instrument.symbol),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  // Persist the real asset type so cached ETFs aren't mislabelled as stocks.
  assetType: text("asset_type").notNull().default("stock"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: numeric("market_cap"),
  peRatio: numeric("pe_ratio"),
  beta: numeric("beta"),
  fiftyTwoWeekHigh: numeric("fifty_two_week_high"),
  fiftyTwoWeekLow: numeric("fifty_two_week_low"),
  dividendYield: numeric("dividend_yield"),
  payoutRatio: numeric("payout_ratio"),
  trailingAnnualDividend: numeric("trailing_annual_dividend"),
  currency: text("currency").notNull(),
  website: text("website"),
  description: text("description"),
  ceo: text("ceo"),
  fullTimeEmployees: text("full_time_employees"),
  ipoDate: text("ipo_date"),
  country: text("country"),
  countryIso: text("country_iso"),
  // Fund/ETF-only fundamentals (null for stocks).
  fundExpenseRatio: numeric("fund_expense_ratio"),
  fundTotalAssets: numeric("fund_total_assets"),
  fundFamily: text("fund_family"),
  fundCategory: text("fund_category"),
  fundLegalType: text("fund_legal_type"),
  fundHoldings: jsonb("fund_holdings").$type<FundHolding[]>(),
  fundSectorWeightings: jsonb("fund_sector_weightings").$type<SectorWeight[]>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
