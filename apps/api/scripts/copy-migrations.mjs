import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src/db/migrations");
const dest = resolve(here, "../dist/db/migrations");
if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`[build] copied migrations -> ${dest}`);
}
