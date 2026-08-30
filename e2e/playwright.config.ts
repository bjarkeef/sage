import { defineConfig, devices } from "@playwright/test";
import { API_PORT, API_URL, DATABASE_URL, WEB_PORT, WEB_URL } from "./config";

export default defineConfig({
  testDir: "./tests",
  // Every spec signs up its own account, but they share one API and one
  // database; serial keeps a failure readable instead of interleaved.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // `dev:e2e`, not `dev`: the normal script loads apps/api/.env, which
      // points DATABASE_URL at the developer's real dev database. This suite
      // writes transactions, so inheriting that file would corrupt real data.
      // Every value the API needs is passed explicitly below.
      // The database is created here rather than in `globalSetup`: Playwright
      // starts webServers *before* globalSetup, so the API would try to migrate
      // a database that does not exist yet and exit.
      command: "node ensure-database.mjs && pnpm --filter @sage/api dev:e2e",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        DATABASE_URL,
        PORT: String(API_PORT),
        AUTH_BASE_URL: API_URL,
        WEB_ORIGIN: WEB_URL,
        // The suite creates its own accounts; there is nothing to lock down.
        ALLOW_SIGNUP: "true",
        // Throwaway: this signs cookies for a disposable local database that
        // is never exposed and never holds real data.
        BETTER_AUTH_SECRET: "e2e-only-not-a-real-secret-0000000000000000",
        MARKET_DATA_PROVIDER: "yahoo",
        NODE_ENV: "development",
      },
    },
    {
      command: "pnpm --filter @sage/web dev",
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(WEB_PORT),
        SAGE_API_URL: API_URL,
        NEXT_PUBLIC_SAGE_API_URL: API_URL,
      },
    },
  ],
});
