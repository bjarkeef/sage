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

/** The Postgres the suite talks to, without a database name.
 *
 *  Overridable because 5432 is not always free: on a maintainer's machine it is
 *  usually their own dev database, and `E2E_ADMIN_URL` alone could not move the
 *  suite off it — the admin connection pointed at one server while the API
 *  still connected to another. */
const SERVER_URL = process.env.E2E_PG_URL ?? "postgres://sage:sage@localhost:5432";

/** Admin connection used only to create the e2e database; `postgres` always
 *  exists and is never the target. */
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? `${SERVER_URL}/postgres`;

export const DATABASE_URL = `${SERVER_URL}/${E2E_DATABASE}`;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
