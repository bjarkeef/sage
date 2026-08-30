/** Ports and database for the end-to-end stack.
 *
 *  Deliberately NOT the dev stack's 3000/3001/`sage`. The suite signs up users
 *  and writes transactions; pointing it at the database a developer keeps their
 *  real portfolio in would corrupt it, and clashing with a running `pnpm dev`
 *  would make failures look like test bugs. Everything here is disposable.
 */
export const WEB_PORT = 3100;
export const API_PORT = 3101;

export const E2E_DATABASE = "sage_e2e";

/** Admin connection used only to create the e2e database; `postgres` always
 *  exists and is never the target. */
export const ADMIN_URL =
  process.env.E2E_ADMIN_URL ?? "postgres://sage:sage@localhost:5432/postgres";

export const DATABASE_URL = `postgres://sage:sage@localhost:5432/${E2E_DATABASE}`;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
