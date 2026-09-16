import { defineConfig } from "vitest/config";

/** Live upstream checks against a real key. Separate from vitest.config.ts so
 *  `pnpm test` cannot reach them: that run must stay offline-safe. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.ts"],
    testTimeout: 60_000,
  },
});
