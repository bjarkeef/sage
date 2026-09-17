import { z } from "zod";

/** The literal values shipped in `.env.example` and `apps/api/.env.example`.
 *  Kept in sync with those files by `env.test.ts`, which reads them from disk —
 *  a drifting copy here would silently stop guarding anything. */
const PLACEHOLDER_SECRETS = new Set([
  "generate-a-random-64-char-hex-string",
  "replace-with-at-least-32-random-characters",
]);

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    MARKET_DATA_PROVIDER: z.enum(["yahoo", "eodhd", "twelvedata"]).default("yahoo"),
    /**
     * Fills in sector, country, industry and the real company name.
     *
     * Defaults to `yahoo` because defaulting to `none` shipped a broken
     * Diversification page: sector, country and region resolved to `Unknown`
     * for every holding on a stock install, which is three of that page's five
     * dimensions. `yahoo` needs no key and is already the default price
     * provider, so this sends the same symbols to the same host that a stock
     * install is contacting anyway — no new disclosure. Set `none` to stop
     * profile lookups entirely and accept the `Unknown` buckets.
     */
    ENRICHMENT_PROVIDER: z.enum(["yahoo", "none"]).default("yahoo"),
    EODHD_API_TOKEN: z.string().optional(),
    TWELVEDATA_API_KEY: z.string().optional(),
    /**
     * The Twelve Data plan's per-minute credit allowance. Requests beyond it
     * are never sent; they fall straight to Yahoo. Default 8 is the free plan's
     * — set it to the plan you pay for (Grow 55, Pro 610, Venture 610).
     */
    TWELVEDATA_CREDITS_PER_MINUTE: z.preprocess(
      // A blank `TWELVEDATA_CREDITS_PER_MINUTE=` means unset, not zero — coerced
      // as-is it would fail startup even on an install that never uses Twelve Data.
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.coerce.number().int().positive().default(8),
    ),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    AUTH_BASE_URL: z.string().url().default("http://localhost:3001"),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    /**
     * When false, email/password registration is disabled (existing users can
     * still sign in). Self-host: create your account, then set ALLOW_SIGNUP=false.
     * Hosted multi-tenant: leave true so new customers can register.
     */
    ALLOW_SIGNUP: z
      .enum(["true", "false", "1", "0"])
      .default("true")
      .transform((v) => v === "true" || v === "1"),
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .superRefine((data, ctx) => {
    // The secrets we ship in .env.example are long enough to satisfy the length
    // rule above, so `cp .env.example .env` produces a bootable dev setup — that
    // is the point of the quick start. It also means a self-hoster who never
    // read the security checklist would run production on a session secret
    // published in this repo, which anyone could use to forge a session.
    //
    // Refused in production only: dev keeps its one-command start, and the
    // self-host image sets NODE_ENV=production, so the guard lands exactly
    // where the risk is.
    if (data.NODE_ENV === "production" && PLACEHOLDER_SECRETS.has(data.BETTER_AUTH_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message:
          "BETTER_AUTH_SECRET is still the example value from .env.example. " +
          "It is public, so anyone could forge a session. Generate one with " +
          "`openssl rand -hex 32`.",
      });
    }
    if (data.MARKET_DATA_PROVIDER === "eodhd" && !data.EODHD_API_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EODHD_API_TOKEN"],
        message: "EODHD_API_TOKEN is required when MARKET_DATA_PROVIDER is 'eodhd'",
      });
    }
    if (data.MARKET_DATA_PROVIDER === "twelvedata" && !data.TWELVEDATA_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TWELVEDATA_API_KEY"],
        message: "TWELVEDATA_API_KEY is required when MARKET_DATA_PROVIDER is 'twelvedata'",
      });
    }
  });

/** Validated environment configuration for the API. */
export type Env = z.infer<typeof EnvSchema>;

/** Validate a set of environment variables, returning typed config.
 *  Throws an aggregated, readable error if validation fails. Defaults to
 *  `process.env`; pass an explicit source in tests. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
