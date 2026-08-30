import designTokens from "./rules/design-tokens.js";

/**
 * Design-system guardrails. All pre-existing violations were cleared in the
 * design-sweep branches; drift now fails CI.
 */
export default [
  {
    files: ["apps/web/**/*.tsx"],
    plugins: {
      "sage-design": { rules: { "no-off-token-classes": designTokens } },
    },
    rules: {
      "sage-design/no-off-token-classes": "error",
    },
  },
];
