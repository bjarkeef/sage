import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./design-tokens.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("no-off-token-classes", () => {
  it("flags off-token classes and allows token classes", () => {
    tester.run("no-off-token-classes", rule, {
      valid: [
        { code: `<div className="text-data rounded-card bg-surface-card" />` },
        { code: `<div className="rounded-full text-sm font-mono" />` },
        { code: `cn("rounded-control", active && "bg-surface-active")` },
        // hex outside class contexts is fine (e.g. chart data)
        { code: `const color = "#3dbe86";` },
      ],
      invalid: [
        { code: `<div className="text-[13.5px]" />`, errors: 1 },
        { code: `<div className="rounded-lg" />`, errors: 1 },
        { code: `<div className="rounded-[6px]" />`, errors: 1 },
        { code: `<div className="text-green-500" />`, errors: 1 },
        { code: `<div className="bg-[#0d0d0c]" />`, errors: 1 },
        { code: `cn("text-[11px]")`, errors: 1 },
        { code: "<div className={`p-4 ${x} rounded-xl`} />", errors: 1 },
        // variant-prefixed raw colors must not slip through
        { code: `<div className="hover:bg-red-500" />`, errors: 1 },
        { code: `<div className="dark:text-blue-600" />`, errors: 1 },
      ],
    });
  });
});
