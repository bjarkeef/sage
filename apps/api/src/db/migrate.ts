import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client";

/**
 * Apply all pending Drizzle migrations from `folder`. No-ops when the folder
 * holds no migrations, so it is safe to call on every boot.
 *
 * The folder is REQUIRED, deliberately. It used to default to a path resolved
 * from this module's own location, which was correct only while `dist` mirrored
 * `src`. Once the API is bundled into a single `dist/index.js`, that default
 * silently resolves somewhere else — and because a missing folder is a no-op
 * rather than an error, a fresh database would come up with no tables and no
 * complaint. Each entry point knows its own deployment layout; this function
 * does not get to guess.
 */
export async function runMigrations(db: Database, folder: string): Promise<void> {
  if (!existsSync(`${folder}/meta/_journal.json`)) {
    console.log("[db] no migrations to apply");
    return;
  }
  // Say when this took real time. A first boot creates the whole schema before
  // the API starts listening, and it did so in total silence — so a slow or
  // stuck migration on someone else's hardware looked identical to a hang with
  // no output at all. One line, and only when it is slow enough to wonder about.
  const started = Date.now();
  await migrate(db, { migrationsFolder: folder });
  const ms = Date.now() - started;
  if (ms > 500) console.log(`[db] migrations applied in ${(ms / 1000).toFixed(1)}s`);
}
