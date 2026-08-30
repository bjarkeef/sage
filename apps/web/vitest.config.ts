import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = {
  esbuild: { jsx: "automatic" as const },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
};

export default defineConfig({
  ...shared,
  test: {
    // Two projects so pure-logic tests skip the ~1.7s jsdom setup each file
    // otherwise pays. A `lib/` test that does need a DOM opts back in with a
    // `// @vitest-environment jsdom` docblock (see lib/chart-config.test.ts)
    // or by being a .tsx component test.
    projects: [
      {
        ...shared,
        test: {
          name: "node",
          environment: "node",
          // `*.test.ts` at the root too, not just under lib/: middleware.ts
          // lives at the app root, and a test file that matches no include
          // pattern is silently never collected — it reads as passing.
          include: ["lib/**/*.test.ts", "*.test.ts"],
        },
      },
      {
        ...shared,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["{app,components}/**/*.test.{ts,tsx}", "lib/**/*.test.tsx"],
        },
      },
    ],
  },
});
