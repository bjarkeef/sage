CREATE TABLE "fx_rate_daily" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"rate" text NOT NULL,
	CONSTRAINT "fx_rate_daily_date_currency_pk" PRIMARY KEY("date","currency")
);
--> statement-breakpoint
CREATE INDEX "fx_rate_daily_currency_date_idx" ON "fx_rate_daily" USING btree ("currency","date");