CREATE INDEX IF NOT EXISTS "transaction_portfolio_id_idx" ON "transaction" ("portfolio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_portfolio_trade_date_idx" ON "transaction" ("portfolio_id","trade_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_user_id_idx" ON "portfolio" ("user_id");
