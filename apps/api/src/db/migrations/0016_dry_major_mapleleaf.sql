CREATE TABLE "auto_dividend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"ex_date" date NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_dividend_identity" UNIQUE("portfolio_id","symbol","ex_date")
);
--> statement-breakpoint
ALTER TABLE "portfolio" ADD COLUMN "auto_add_dividends" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "auto_dividend" ADD CONSTRAINT "auto_dividend_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_dividend" ADD CONSTRAINT "auto_dividend_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_dividend_transaction_id_idx" ON "auto_dividend" USING btree ("transaction_id");