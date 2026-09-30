-- Per-user switches for the two features that make the browser ask a third
-- party about a holding: company logos (logo.dev) and news thumbnails (each
-- publisher's image host). Both default off, so no existing account starts
-- making requests it did not make before. `logo_dev_token` is an optional
-- per-user publishable key; null falls back to the operator's build-time one.
ALTER TABLE "user" ADD COLUMN "show_company_logos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "logo_dev_token" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "show_news_thumbnails" boolean DEFAULT false NOT NULL;
