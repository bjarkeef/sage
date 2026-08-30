import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Create a Drizzle client backed by postgres.js. Returns both the Drizzle
 *  instance and the raw `sql` handle so callers (and tests) can close it.
 *  postgres.js connects lazily, so this does not open a socket.
 *
 *  `maxConnections` caps the pool; tests use a small value because many
 *  clients share one Postgres. Omit it for the postgres.js default. */
export function createDb(connectionString: string, maxConnections?: number) {
  const sql = postgres(connectionString, {
    ...(maxConnections ? { max: maxConnections } : {}),
    onnotice: onNotice,
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

/**
 * postgres.js prints every server NOTICE to stderr as a multi-line object.
 * On an API restart the migration runner raises two of them — `schema "drizzle"
 * already exists, skipping` and the same for `__drizzle_migrations` — so the
 * only output a self-hoster sees after `docker compose restart` is two blocks
 * carrying `severity`, `code`, `file`, `line` and `routine`. They are benign
 * and they read exactly like a crash.
 *
 * "Already exists, skipping" is what a correct re-run looks like, so those are
 * dropped. Anything else a NOTICE says is still worth one line — swallowing the
 * whole channel would hide real server warnings.
 */
function onNotice(notice: { severity?: string; code?: string; message?: string }): void {
  // 42P06 duplicate_schema, 42P07 duplicate_table — the idempotent-migration pair.
  if (notice.code === "42P06" || notice.code === "42P07") return;
  console.log(`[db] ${notice.severity ?? "NOTICE"}: ${notice.message ?? ""}`.trimEnd());
}

/** The Drizzle database instance type used across the API. */
export type Database = ReturnType<typeof createDb>["db"];
