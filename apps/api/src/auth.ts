import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "./db/client";
import type { Env } from "./env";
import { portfolio } from "./db/schema";

export function createAuth(db: Database, env: Env) {
  const origins = env.WEB_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return betterAuth({
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg" }),
    emailAndPassword: {
      enabled: true,
      // Self-host single-user: set ALLOW_SIGNUP=false after creating the owner.
      // Hosted multi-tenant wrapper: leave ALLOW_SIGNUP=true.
      disableSignUp: !env.ALLOW_SIGNUP,
    },
    trustedOrigins: origins,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.insert(portfolio).values({ userId: user.id, name: "Default" });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export async function getUserPortfolio(db: Database, userId: string): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: portfolio.id })
    .from(portfolio)
    .where(eq(portfolio.userId, userId))
    .limit(1);
  if (!row) throw new Error(`No portfolio found for user ${userId}`);
  return row;
}
