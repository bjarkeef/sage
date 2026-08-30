CREATE TABLE "price_daily" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric NOT NULL,
	"high" numeric NOT NULL,
	"low" numeric NOT NULL,
	"close" numeric NOT NULL,
	"volume" numeric NOT NULL,
	"currency" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_daily_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "price_quote" (
	"symbol" text PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"currency" text NOT NULL,
	"previous_close" numeric,
	"as_of" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
