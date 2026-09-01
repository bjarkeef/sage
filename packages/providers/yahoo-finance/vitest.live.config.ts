import { defineConfig } from "vitest/config";

/** Live upstream checks. Separate from vitest.config.ts so `pnpm test` cannot
 *  reach them: that run must stay offline-safe and deterministic. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.ts"],
    // A hung upstream should fail the job, not hang the runner. Room for the
    // three attempts in `live()` and the 7s of backoff between them: at 30s a
    // slow-but-working upstream would time out mid-retry and report as broken,
    // which is the failure this retry exists to stop.
    testTimeout: 60_000,
  },
});
