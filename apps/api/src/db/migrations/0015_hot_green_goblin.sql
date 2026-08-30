CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"target_year" integer NOT NULL,
	"monthly_contribution" numeric(18, 2),
	"contribution_increase" text DEFAULT 'inflation' NOT NULL,
	"contribution_increase_pct" numeric(5, 2),
	"div_yield_pct" numeric(5, 2),
	"div_growth_pct" numeric(5, 2),
	"annual_return_pct" numeric(5, 2),
	"adjust_goal_for_inflation" boolean DEFAULT true NOT NULL,
	"inflation_pct" numeric(5, 2) DEFAULT '2.5' NOT NULL,
	"reinvest_dividends" boolean DEFAULT true NOT NULL,
	"suggest_alternative" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_portfolio_id_unique" UNIQUE("portfolio_id")
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;