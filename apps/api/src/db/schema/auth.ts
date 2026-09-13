import { pgTable, text, timestamp, boolean, jsonb, numeric, unique } from "drizzle-orm/pg-core";

/** Per-user toggles for optional overview-page sections. All default to
 *  shown (`true`); stored as a nullable partial so unset keys fall back to
 *  the default rather than needing a migration whenever a new section is
 *  added. */
export interface OverviewPrefs {
  brief: boolean;
  paydayGreeting: boolean;
  marketState: boolean;
  /** @deprecated superseded by incomeCard; still honored via fillDefaults. */
  incomeRoom: boolean;
  /** @deprecated superseded by portfolioCard; still honored via fillDefaults. */
  portfolioRoom: boolean;
  statStrip: boolean;
  /** The "living on it by <year>" progress band on the overview. */
  goalBand: boolean;
  performanceCard: boolean;
  incomeCard: boolean;
  portfolioCard: boolean;
  upcomingCard: boolean;
}

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  displayCurrency: text("display_currency"),
  overviewPrefs: jsonb("overview_prefs").$type<Partial<OverviewPrefs>>(),
  /** Single configurable dividend tax rate, 0-100 as a percent. Nullable —
   *  Sage has no tax-residency model, so this is an opt-in user estimate used
   *  only to derive the Yield card's net-after-tax headline. */
  dividendTaxRate: numeric("dividend_tax_rate", { precision: 5, scale: 2 }),
  /** When false, the portfolio-level dividend-growth default (Goal page)
   *  floors every holding's CAGR at 0% before weighting — so a declining
   *  holding can't pull the aggregate negative. Defaults true (honest signed
   *  average) so existing users see no silent change. */
  allowNegativeDividendGrowth: boolean("allow_negative_dividend_growth").notNull().default(true),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    /** Which authority vouches for this identity. Required by better-auth
     *  since 1.7, which scopes account identity by it rather than by
     *  `providerId` alone. Sage configures `emailAndPassword` and no social
     *  providers, so every row is better-auth's own
     *  `createLocalAccountIssuer("credential")` — the literal `local:credential`.
     *  Not nullable: better-auth's schema declares `issuer: z.string()`, and a
     *  null here makes it reject every write on the table. */
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // better-auth declares this index itself (`fields: ["issuer", "accountId"],
  // unique: true`). It is what "account identity is scoped by issuer" means:
  // the same account id from two different authorities is two identities.
  (t) => [unique("account_issuer_account_id").on(t.issuer, t.accountId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
