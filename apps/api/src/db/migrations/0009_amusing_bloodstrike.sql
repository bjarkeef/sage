ALTER TABLE "asset_profile" ADD COLUMN "asset_type" text DEFAULT 'stock' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_expense_ratio" numeric;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_total_assets" numeric;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_family" text;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_category" text;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_legal_type" text;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_holdings" jsonb;--> statement-breakpoint
ALTER TABLE "asset_profile" ADD COLUMN "fund_sector_weightings" jsonb;