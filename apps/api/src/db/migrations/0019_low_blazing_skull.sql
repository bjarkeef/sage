CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_pct" numeric,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_portfolio_name" UNIQUE("portfolio_id","name")
);
--> statement-breakpoint
CREATE TABLE "category_assignment" (
	"portfolio_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"category_id" uuid,
	"target_pct" numeric,
	CONSTRAINT "category_assignment_portfolio_symbol" UNIQUE("portfolio_id","symbol")
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignment" ADD CONSTRAINT "category_assignment_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignment" ADD CONSTRAINT "category_assignment_symbol_instrument_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."instrument"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_assignment" ADD CONSTRAINT "category_assignment_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;