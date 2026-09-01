// Create the disposable e2e database if it is missing.
//
// Runs as part of the API's webServer command rather than as Playwright's
// `globalSetup`, because Playwright starts webServers *before* globalSetup —
// the API would try to migrate a database that does not exist yet and exit.
//
// Plain .mjs so it needs no transpile step ahead of the servers.
import postgres from "postgres";

const DATABASE = "sage_e2e";
// Keep both overrides in step with e2e/config.ts. If this honoured only
// E2E_ADMIN_URL, moving the suite off port 5432 would create the database on
// one server while the API connected to another.
const SERVER_URL = process.env.E2E_PG_URL ?? "postgres://sage:sage@localhost:5432";
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? `${SERVER_URL}/postgres`;

if (DATABASE === "sage") {
  throw new Error("Refusing to run: the e2e database must not be the dev database.");
}

const admin = postgres(ADMIN_URL, { max: 1 });
try {
  const existing = await admin`select 1 from pg_database where datname = ${DATABASE}`;
  if (existing.length === 0) {
    // Identifier cannot be parameterised; DATABASE is a constant here.
    await admin.unsafe(`create database ${DATABASE}`);
    console.log(`[e2e] created database ${DATABASE}`);
  }
} catch (err) {
  console.error(
    `[e2e] could not reach Postgres at ${ADMIN_URL.replace(/:[^:@]+@/, ":***@")}.\n` +
      `Start it with \`docker compose up -d db\` from the repo root.`,
  );
  throw err;
} finally {
  await admin.end();
}
