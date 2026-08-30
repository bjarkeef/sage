import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { TEMPLATE_DB, uriWithDatabase } from "./template";

/** Tests always run from source, so this resolves off this file's own location.
 *  The bundled image uses its own path — see `MIGRATIONS_FOLDER` in src/index.ts. */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations");

declare module "vitest" {
  interface ProvidedContext {
    /** Admin connection URI for the shared test Postgres, or "" when
     *  SKIP_DB_TESTS=1 left the container unstarted. */
    postgresUri: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/** Start one Postgres container for the whole run and migrate a template
 *  database inside it. Test files then clone that template per suite
 *  (see `withTestDb`), which costs ~46ms instead of the ~2.1s a fresh
 *  container plus migrations used to cost each time. */
export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  if (process.env.SKIP_DB_TESTS === "1") {
    provide("postgresUri", "");
    return;
  }

  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const adminUri = container.getConnectionUri();

  const admin = createDb(adminUri);
  await admin.sql.unsafe(`create database ${TEMPLATE_DB}`);
  await admin.sql.end();

  // Migrate over a connection we then close completely: Postgres refuses to
  // use a database as a CREATE DATABASE template while anyone is connected.
  const template = createDb(uriWithDatabase(adminUri, TEMPLATE_DB));
  await runMigrations(template.db, MIGRATIONS_FOLDER);
  await template.sql.end();

  provide("postgresUri", adminUri);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
