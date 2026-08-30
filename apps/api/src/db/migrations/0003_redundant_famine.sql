CREATE TABLE "asset_profile" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exchange" text NOT NULL,
	"sector" text,
	"industry" text,
	"market_cap" numeric,
	"pe_ratio" numeric,
	"beta" numeric,
	"fifty_two_week_high" numeric,
	"fifty_two_week_low" numeric,
	"dividend_yield" numeric,
	"trailing_annual_dividend" numeric,
	"currency" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_profile" ADD CONSTRAINT "asset_profile_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE no action ON UPDATE no action;