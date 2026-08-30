/**
 * Mint a browser session for a local dev user, without a password.
 *
 * Why this exists: verifying UI work in a real browser needs an authenticated
 * session. The alternatives are worse — typing a password into the sign-in form
 * means a credential has to live somewhere readable, and creating a throwaway
 * account each time leaves rows behind and still needs one. This asks
 * better-auth for a session through its own server context, so the cookie is
 * issued exactly as a successful sign-in would issue it.
 *
 * Refuses to run with NODE_ENV=production. It lives under `scripts/`, not
 * `src/`, so esbuild never bundles it into `dist/` and it cannot ship in the
 * API image — unlike the `sage` CLI, which does.
 *
 *   pnpm --filter @sage/api dev-session <email>
 *
 * stdout is exactly `<name>=<value>`, so it can be piped straight into a
 * browser's cookie jar or a `curl --cookie`. Detail goes to stderr.
 */
import { eq } from "drizzle-orm";
import { makeSignature } from "better-auth/crypto";
import { createDb } from "../src/db/client";
import { createAuth } from "../src/auth";
import { parseEnv } from "../src/env";
import { user as userTable } from "../src/db/schema";

async function main() {
  const env = parseEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("dev-session refuses to run with NODE_ENV=production");
  }

  const email = process.argv[2];
  if (!email) throw new Error("usage: dev-session <email>");

  const { db } = createDb(env.DATABASE_URL);
  const [row] = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
  if (!row) throw new Error(`no user with email ${email} in this database`);

  const auth = createAuth(db, env);
  // `$context` is better-auth's own server context — the same internal adapter
  // a real sign-in goes through, so this cannot drift from how the app issues
  // sessions.
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(row.id, false);

  // The session cookie is SIGNED — the raw token alone is rejected as
  // unauthorized. `value.signature` with an HMAC-SHA256 over the secret is the
  // format, and `makeSignature` is better-auth's own helper for it (the same
  // one its `test-utils/cookie-builder` uses), so this cannot drift from how
  // the server verifies.
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;

  process.stderr.write(
    [
      `user    ${row.email} (${row.id})`,
      `expires ${new Date(session.expiresAt).toISOString()}`,
      `cookie  ${ctx.authCookies.sessionToken.name}`,
      "",
    ].join("\n"),
  );
  process.stdout.write(`${ctx.authCookies.sessionToken.name}=${signed}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
