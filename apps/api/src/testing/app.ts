import { vi } from "vitest";
import type { createApp } from "../app";
import type { Auth } from "../auth";
import type { Env } from "../env";

/** Baseline API config for tests: no provider keys, signup open, auth secret
 *  long enough to satisfy the schema. Spread it to vary a field —
 *  `{ ...testEnv, EODHD_API_TOKEN: "..." }`. */
export const testEnv: Env = {
  DATABASE_URL: "unused",
  MARKET_DATA_PROVIDER: "yahoo",
  ENRICHMENT_PROVIDER: "none",
  PORT: 3001,
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  AUTH_BASE_URL: "http://localhost:3001",
  WEB_ORIGIN: "http://localhost:3000",
  ALLOW_SIGNUP: true,
  TWELVEDATA_CREDITS_PER_MINUTE: 8,
};

/** An `Auth` stub for suites that exercise routes without a real session. */
export function fakeAuth(): Auth {
  return {
    api: { getSession: vi.fn().mockResolvedValue(null) },
    handler: vi.fn(),
  } as unknown as Auth;
}

type App = ReturnType<typeof createApp>;

/** Register a user and return its session cookie.
 *
 *  Suites sharing one database must pass distinct emails, since a test db is
 *  cloned per suite but not reset between tests within one. */
export async function signUpTestUser(
  app: App,
  email = "test@example.com",
  name = "Test User",
): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: "test-password-at-least-8-chars" }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no session cookie in sign-up response");
  return setCookie;
}
