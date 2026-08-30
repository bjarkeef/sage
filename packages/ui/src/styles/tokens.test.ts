import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Reads tokens.css as text and resolves CSS custom properties the same way
// the cascade would, so this guards the actual regression: two chart series
// tokens resolving to the same real colour. A DOM-level test cannot do this
// -- jsdom's cssstyle never resolves var(...) references, so a component test
// comparing `.style.background` strings only catches a literal copy-paste
// typo (reusing one variable name twice), never two different variables that
// happen to resolve to the same colour. See portfolio-chart.test.tsx for that
// narrower guard.

const tokensPath = join(__dirname, "tokens.css");
const css = readFileSync(tokensPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function parseVars(blockBody: string): Map<string, string> {
  const vars = new Map<string, string>();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(blockBody))) {
    vars.set(match[1]!, match[2]!.trim());
  }
  return vars;
}

// Two separate `:root` blocks: Layer 1 primitives (--gray-500, --seg-4, ...)
// and Layer 2 semantic roles (--chart-comparison-1, --chart-line, ...). Merge
// them -- their key sets don't overlap -- into one "light" map.
const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!);
if (rootBlocks.length === 0) {
  throw new Error("tokens.css: no :root block found -- has the file structure changed?");
}
const lightVars = new Map<string, string>();
for (const body of rootBlocks) {
  for (const [k, v] of parseVars(body)) lightVars.set(k, v);
}

const darkMatch = /\.dark\s*\{([^}]*)\}/.exec(css);
if (!darkMatch) {
  throw new Error("tokens.css: no .dark block found -- has the file structure changed?");
}
const darkVars = parseVars(darkMatch[1]!);

/** Resolve a token to its literal value, following `var(--x)` indirection
 *  through the given theme's own block first, falling back to the merged
 *  :root (light) block when the theme block does not redefine that variable
 *  -- which is exactly how the cascade behaves for a token .dark doesn't
 *  override. */
function resolve(
  name: string,
  ownVars: Map<string, string>,
  fallbackVars: Map<string, string>,
  seen = new Set<string>(),
): string {
  if (seen.has(name)) {
    throw new Error(`tokens.css: circular var() reference at --${name}`);
  }
  seen.add(name);
  const raw = ownVars.get(name) ?? fallbackVars.get(name);
  if (raw === undefined) {
    throw new Error(`tokens.css: --${name} is not defined in this theme or in :root`);
  }
  const indirection = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(raw);
  if (indirection) {
    return resolve(indirection[1]!, ownVars, fallbackVars, seen);
  }
  return raw;
}

describe("chart comparison tokens (tokens.css)", () => {
  it.each([
    ["light", lightVars, lightVars],
    ["dark", darkVars, lightVars],
  ])(
    "%s theme: the two benchmark tokens resolve to different colours, neither matching the portfolio line",
    (_themeName, ownVars, fallbackVars) => {
      const comparison1 = resolve("chart-comparison-1", ownVars, fallbackVars);
      const comparison2 = resolve("chart-comparison-2", ownVars, fallbackVars);
      const chartLine = resolve("chart-line", ownVars, fallbackVars);

      // Sanity: every resolved value must bottom out at a literal (hex/rgb/etc),
      // never an unresolved var() -- otherwise the inequality checks below are
      // comparing indirection chains rather than real colours.
      expect(comparison1).not.toMatch(/^var\(/);
      expect(comparison2).not.toMatch(/^var\(/);
      expect(chartLine).not.toMatch(/^var\(/);

      expect(comparison1).not.toBe(comparison2);
      expect(comparison1).not.toBe(chartLine);
      expect(comparison2).not.toBe(chartLine);
    },
  );
});
