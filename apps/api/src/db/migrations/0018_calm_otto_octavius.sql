CREATE TABLE "custom_holding" (
	"symbol" text PRIMARY KEY NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"holding_type" text DEFAULT 'other' NOT NULL,
	"sector" text,
	"country" text,
	"note" text,
	"income_enabled" boolean DEFAULT false NOT NULL,
	"income_yearly_pct" numeric,
	"frequency_unit" text,
	"frequency_interval" integer DEFAULT 1 NOT NULL,
	"first_payment_date" date,
	"last_payment_date" date,
	"auto_add" boolean DEFAULT true NOT NULL,
	"reinvest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_income" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"pay_date" date NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_income_identity" UNIQUE("portfolio_id","symbol","pay_date")
);
--> statement-breakpoint
CREATE TABLE "manual_price" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"price" numeric NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_price_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
ALTER TABLE "custom_holding" ADD CONSTRAINT "custom_holding_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_holding" ADD CONSTRAINT "custom_holding_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_income" ADD CONSTRAINT "custom_income_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_income" ADD CONSTRAINT "custom_income_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_price" ADD CONSTRAINT "manual_price_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_income_transaction_id_idx" ON "custom_income" USING btree ("transaction_id");