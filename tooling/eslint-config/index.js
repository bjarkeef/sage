import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import noIdentifyingTickers from "./rules/no-identifying-tickers.js";

/**
 * Shared flat ESLint configuration for all Sage packages and apps.
 *
 * Type-aware rules run on TypeScript files via the typescript-eslint
 * project service (no per-package parser wiring needed). Plain JS and
 * config files fall back to the non-type-checked rule set.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      // Git worktrees live here. They are full copies of the repo, so without
      // this `pnpm lint` from the primary checkout lints every file twice and
      // reports errors against a checkout nobody is editing.
      "**/.claude/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // `any` is banned. Prefer `unknown` + narrowing. If genuinely
      // unavoidable, suppress locally and state why:
      //   // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: <why>
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Plain JS/MJS/CJS are Node tooling and scripts (config files, fixture
    // capture, etc.): no type-aware rules, and Node globals are in scope.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Repo-wide, not just apps/web: the tickers this bans arrived through API
    // fixtures and core dividend tests, and the constant that started the
    // sweep named one in a docblock in packages/core.
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    plugins: {
      "sage-hygiene": { rules: { "no-identifying-tickers": noIdentifyingTickers } },
    },
    rules: {
      "sage-hygiene/no-identifying-tickers": "error",
    },
  },
);
