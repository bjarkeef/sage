ALTER TABLE "instrument" ADD COLUMN "isin" text;--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "primary_symbol" text;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_isin_unique" UNIQUE("isin");