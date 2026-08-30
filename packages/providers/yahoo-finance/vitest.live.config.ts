import { defineConfig } from "vitest/config";

/** Live upstream checks. Separate from vitest.config.ts so `pnpm test` cannot
 *  reach them: that run must stay offline-safe and deterministic. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.ts"],
    // A hung upstream should fail the job, not hang the runner.
    testTimeout: 30_000,
  },
});
