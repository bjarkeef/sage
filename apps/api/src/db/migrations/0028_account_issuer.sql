-- better-auth 1.7 scopes account identity by `issuer` rather than by
-- `providerId` alone, and declares the column required (`issuer: z.string()`).
-- Without it the library refuses EVERY write to the table: sign-up, sign-in and
-- password reset all fail with `The field "issuer" does not exist in the
-- "account" Drizzle schema`.
--
-- Three steps, because `ADD COLUMN ... NOT NULL` with no default fails on any
-- table that already has rows — which is every existing Sage install.

ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint

-- Sage configures `emailAndPassword` and no social providers, so in practice
-- every row is `credential`. The value is not ours to invent: better-auth
-- writes `createLocalAccountIssuer("credential")`, which is the literal
-- `local:credential`, and would not match a row we labelled differently.
UPDATE "account" SET "issuer" = 'local:credential' WHERE "provider_id" = 'credential';--> statement-breakpoint

-- Anything else can only exist if a fork added a social provider. Better-auth's
-- own form for a provider with no issuer of its own is `local:oauth:<id>`
-- (percent-encoded, which is a no-op for the slug-shaped ids providers use).
-- This branch cannot fire on stock Sage; it is here so the NOT NULL below
-- cannot abort somebody's upgrade half-way.
UPDATE "account" SET "issuer" = 'local:oauth:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint

-- better-auth declares this index itself: two authorities may legitimately use
-- the same account id, and they are different identities. For credential rows
-- `account_id` is the user id, so this reduces to one credential account per
-- user — already true, and a collision here would be a real duplicate worth
-- failing on.
ALTER TABLE "account" ADD CONSTRAINT "account_issuer_account_id" UNIQUE("issuer","account_id");
