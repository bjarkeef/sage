ALTER TABLE "dividend_history" ADD COLUMN "record_date" date;--> statement-breakpoint
ALTER TABLE "dividend_history" ADD COLUMN "declaration_date" date;--> statement-breakpoint
ALTER TABLE "dividend_history" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "dividend_history" ADD COLUMN "payment_date_estimated" boolean DEFAULT false NOT NULL;