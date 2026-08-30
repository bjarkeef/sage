CREATE TABLE "dividend_history" (
	"symbol" text NOT NULL,
	"ex_date" date NOT NULL,
	"amount_per_share" numeric NOT NULL,
	"currency" text NOT NULL,
	"payment_date" date,
	"source" text DEFAULT 'provider' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dividend_history_symbol_ex_date" UNIQUE("symbol","ex_date")
);
--> statement-breakpoint
ALTER TABLE "dividend_history" ADD CONSTRAINT "dividend_history_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE no action ON UPDATE no action;