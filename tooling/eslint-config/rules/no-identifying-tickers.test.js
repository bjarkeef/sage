import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./no-identifying-tickers.js";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

// The invalid cases below use invented, unapproved symbols rather than the real
// ones this rule exists to keep out. The rule does not special-case any symbol
// — anything suffixed and not on the list fails — so an invented one proves the
// mechanism exactly as well, without this file becoming the one place in the
// repo that still spells the real tickers out.
describe("no-identifying-tickers", () => {
  it("allows approved symbols and flags unapproved suffixed ones", () => {
    tester.run("no-identifying-tickers", rule, {
      valid: [
        // Approved fictional symbols.
        { code: `const s = "THAMES.L";` },
        { code: `const s = "SVEAFAST.ST";` },
        { code: `const s = "NORDLAS-B.ST";` },
        { code: `const s = "0THAM.L";` },
        // Benchmark configuration, deliberately real.
        { code: `const s = "IWDA.L";` },
        { code: `const s = "SP500TR.INDX";` },
        // Bare tickers are out of scope — no suffix, nothing to check against.
        { code: `const s = "AAPL";` },
        { code: `const s = "NORDA-B";` },
        // Things that merely contain a dot must not be mistaken for symbols.
        { code: `const s = "application/json";` },
        { code: `const s = "2026-05-29";` },
        { code: `const s = "v1.1";` },
        { code: `import x from "./dividends";` },
        // Lowercase is not a symbol literal.
        { code: `const s = "eudiv.de";` },
        // The live provider test needs symbols that actually exist.
        { code: `const s = "UNLISTED.ST";`, filename: "src/yahoo.live.ts" },
      ],
      invalid: [
        // A Copenhagen listing that nobody approved.
        { code: `const s = "UNLISTED.CO";`, errors: 1 },
        // Share-class hyphen plus suffix — the shape a Nordic listing has.
        { code: `const s = "UNLISTED-B.CO";`, errors: 1 },
        // Inside a CSV fixture row, which is how they arrived last time.
        { code: `const row = 'BUY,2025-01-08,UNLISTED.CO,"164.8","4",DKK';`, errors: 1 },
        // Template literals, e.g. an MSW request path.
        { code: "const s = `${BASE}/div/UNLISTED.LSE`;", errors: 1 },
        // Comments count — the constant that started the sweep named a real
        // holding in a docblock, not in a fixture.
        { code: `// an 8-day EUR/SEK gap on UNLISTED.ST\nconst x = 1;`, errors: 1 },
        { code: `/** Shaped like UNLISTED.DE. */\nconst x = 1;`, errors: 1 },
      ],
    });
  });
});
