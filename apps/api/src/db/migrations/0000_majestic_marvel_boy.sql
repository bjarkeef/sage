CREATE TABLE "instrument" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exchange" text NOT NULL,
	"currency" text NOT NULL,
	"asset_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_symbol" text NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"price" numeric NOT NULL,
	"currency" text NOT NULL,
	"trade_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_instrument_symbol_instrument_symbol_fk" FOREIGN KEY ("instrument_symbol") REFERENCES "public"."instrument"("symbol") ON DELETE no action ON UPDATE no action;