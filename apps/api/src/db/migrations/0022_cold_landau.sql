CREATE TABLE "analyst_ratings_cache" (
	"symbol" text PRIMARY KEY NOT NULL,
	"data" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_cache" (
	"symbol" text PRIMARY KEY NOT NULL,
	"articles" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyst_ratings_cache" ADD CONSTRAINT "analyst_ratings_cache_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_cache" ADD CONSTRAINT "news_cache_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE no action ON UPDATE no action;