CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"source" text NOT NULL,
	"row_hash" text NOT NULL,
	"occurrence" integer DEFAULT 0 NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_row_identity" UNIQUE("portfolio_id","row_hash","occurrence")
);
--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_row_transaction_id_idx" ON "import_row" USING btree ("transaction_id");