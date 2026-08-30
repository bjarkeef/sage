/** Name of the migrated template database built once per test run by
 *  `global-setup.ts`. Every test database is a copy-on-write clone of it. */
export const TEMPLATE_DB = "sage_test_template";

/** Swap the database name in a Postgres connection URI, preserving
 *  credentials, host and port. */
export function uriWithDatabase(uri: string, database: string): string {
  const parsed = new URL(uri);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
