import { randomBytes } from "node:crypto";
import { describe, inject } from "vitest";
import postgres from "postgres";
import { createDb, type Database } from "../db/client";
import { TEMPLATE_DB, uriWithDatabase } from "./template";

/** A live test database plus a teardown handle. */
export interface TestDb {
  db: Database;
  stop: () => Promise<void>;
}

/** Use for any suite that needs Postgres. Skips the whole suite when
 *  SKIP_DB_TESTS=1, so contributors without Docker can still run the rest of
 *  the suite with `SKIP_DB_TESTS=1 pnpm test`. */
export function describeDb(name: string, fn: () => void): void {
  describe.skipIf(process.env.SKIP_DB_TESTS === "1")(name, fn);
}

/** Advisory-lock key guarding template cloning. CREATE DATABASE briefly
 *  connects to its template, so two workers cloning at once can fail with
 *  "source database is being accessed by other users". */
const CLONE_LOCK = 4711;

/** Connections per test database. */
const TEST_POOL_SIZE = 3;

let counter = 0;

/** Name for one cloned test database.
 *
 *  The random suffix is load-bearing. Vitest's default pool runs workers as
 *  worker_threads inside a single process, so `process.pid` is identical across
 *  workers while `counter` is per-worker module state that restarts at 0 — on
 *  pid+counter alone, two workers both ask for `sage_test_<pid>_1` and the
 *  loser fails with `database ... already exists`, reddening whichever
 *  unrelated suite happened to be second. */
export function testDbName(seq: number): string {
  return `sage_test_${process.pid}_${seq}_${randomBytes(4).toString("hex")}`;
}

/** Clone the migrated template database and return a connected Drizzle db.
 *  The schema is already migrated — callers must not run migrations. Call
 *  `stop()` in `afterAll` to close the connection.
 *
 *  Requires the global setup to have started Postgres (see `global-setup.ts`);
 *  use `describeDb` so the suite skips cleanly when it has not. */
export async function withTestDb(): Promise<TestDb> {
  const baseUri = inject("postgresUri");
  if (!baseUri) {
    throw new Error(
      "No test Postgres available. Wrap the suite in `describeDb` so it skips when SKIP_DB_TESTS=1.",
    );
  }

  const name = testDbName(++counter);

  // max: 1 so the advisory lock and the CREATE DATABASE share one session.
  const admin = postgres(baseUri, { max: 1 });
  try {
    await admin.unsafe(`select pg_advisory_lock(${CLONE_LOCK})`);
    await admin.unsafe(`create database ${name} template ${TEMPLATE_DB}`);
    await admin.unsafe(`select pg_advisory_unlock(${CLONE_LOCK})`);
  } finally {
    await admin.end();
  }

  // Tests inside a suite run sequentially, so a small pool is plenty. It also
  // keeps the suite well inside Postgres' 100-connection default if anyone
  // raises `maxWorkers`: at 4 workers this peaks near 12 connections, not 40.
  const { db, sql } = createDb(uriWithDatabase(baseUri, name), TEST_POOL_SIZE);
  return {
    db,
    // The database itself is left behind; the container is torn down at the end
    // of the run, so dropping it would only cost another round trip.
    stop: async () => {
      await sql.end();
    },
  };
}
