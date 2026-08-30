import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

/**
 * Bundles the API into a single runnable ESM file.
 *
 * This has to be a bundle, not a `tsc` emit. The monorepo is built for a
 * transpile-on-the-fly toolchain — `moduleResolution: "Bundler"`, and every
 * workspace package exports raw `./src/index.ts` with no build step — so plain
 * `tsc` output cannot run under Node twice over: relative imports come out
 * without the `.js` extensions Node's ESM loader requires, and `@sage/*`
 * resolves to TypeScript that Node cannot parse. Bundling makes the "Bundler"
 * resolution setting true in production instead of only in dev and tests.
 *
 * npm dependencies stay external and are installed normally in the image —
 * only our own source is inlined. Bundling third-party code buys little here
 * and breaks packages that resolve files at runtime.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

// Everything from npm stays external; workspace packages get bundled in.
// Derived from package.json so a new dependency cannot silently drift.
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@sage/"));

await build({
  absWorkingDir: root,
  // Two programs from one bundle config: the server, and the operator CLI that
  // recovers a locked-out account. `outdir` rather than `outfile` because
  // esbuild rejects `outfile` with more than one entry point.
  entryPoints: ["src/index.ts", "src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
