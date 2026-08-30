import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // One Postgres container for the whole run, holding a migrated template
    // database that each suite clones via `withTestDb()` (~46ms) instead of
    // starting its own container and migrating it (~2.1s). Set SKIP_DB_TESTS=1
    // to skip every database-backed suite on a machine without Docker.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The clones are cheap but they all share one Postgres, so keep the number
    // of concurrent connections bounded.
    maxWorkers: 4,
    // Covers the container pull + start on a cold machine.
    hookTimeout: 60_000,
    // Every suite here talks to Postgres, and a GitHub runner is roughly an
    // order of magnitude slower at it than a dev machine: the bulk-write test
    // in price-store takes ~590ms locally and measured 5,356ms in CI, which
    // reddened main on a commit that touched only .gitignore. Vitest's 5s
    // default is a unit-test number; hookTimeout was already raised for the
    // same reason and testTimeout was simply missed.
    testTimeout: 20_000,
  },
});
