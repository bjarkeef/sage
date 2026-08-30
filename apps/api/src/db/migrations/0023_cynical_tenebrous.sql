CREATE TABLE "fx_rate_cache" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_cache_base_quote_pk" PRIMARY KEY("base","quote")
);
