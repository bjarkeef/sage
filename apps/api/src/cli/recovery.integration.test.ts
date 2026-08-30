import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createAuth } from "../auth";
import { createApp } from "../app";
import { account, session } from "../db/schema";
import {
  listAccounts,
  resolveTarget,
  resetPassword,
  passwordBounds,
  RecoveryError,
} from "./recovery";

const ORIGINAL_PASSWORD = "test-password-at-least-8-chars";
const NEW_PASSWORD = "a-brand-new-password-42";

/** A Database whose session delete throws once inside the transaction, so the
 *  UPDATE has already run when it fails. Without db.transaction the password
 *  change would commit and the old password would stop working. */
function dbWithFailingDelete(real: TestDb["db"]): TestDb["db"] {
  return new Proxy(real, {
    get(target, prop, receiver): unknown {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver) as unknown;
      return (cb: (tx: unknown) => unknown) =>
        target.transaction((tx) =>
          Promise.resolve(
            cb(
              new Proxy(tx as object, {
                get(txTarget, txProp, txReceiver): unknown {
                  if (txProp === "delete") {
                    return () => {
                      throw new Error("injected failure: session delete");
                    };
                  }
                  return Reflect.get(txTarget, txProp, txReceiver) as unknown;
                },
              }),
            ),
          ),
        );
    },
  });
}

describeDb("account recovery", () => {
  let tdb: TestDb;
  let auth: ReturnType<typeof createAuth>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tdb = await withTestDb();
    auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
  }, 120_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  async function signIn(email: string, password: string) {
    return app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  }

  // THE test. Asserting that a row changed proves nothing about the hash being
  // in a format better-auth accepts — which is the exact failure a hand-written
  // SQL procedure would ship.
  it("lets the user sign in with the new password, through better-auth itself", async () => {
    const email = "roundtrip@example.com";
    await signUpTestUser(app, email);

    const target = resolveTarget(await listAccounts(tdb.db), email);
    await resetPassword(tdb.db, auth, target, NEW_PASSWORD);

    const withNew = await signIn(email, NEW_PASSWORD);
    expect(withNew.status).toBe(200);
  });

  it("stops the old password working", async () => {
    const email = "oldpass@example.com";
    await signUpTestUser(app, email);

    const target = resolveTarget(await listAccounts(tdb.db), email);
    await resetPassword(tdb.db, auth, target, NEW_PASSWORD);

    const withOld = await signIn(email, ORIGINAL_PASSWORD);
    expect(withOld.status).not.toBe(200);
  });

  it("revokes every session the user had open", async () => {
    const email = "sessions@example.com";
    await signUpTestUser(app, email);

    const target = resolveTarget(await listAccounts(tdb.db), email);
    const before = await tdb.db.select().from(session).where(eq(session.userId, target.userId));
    expect(before.length).toBeGreaterThan(0);

    const { sessionsRevoked } = await resetPassword(tdb.db, auth, target, NEW_PASSWORD);

    const after = await tdb.db.select().from(session).where(eq(session.userId, target.userId));
    expect(after).toHaveLength(0);
    expect(sessionsRevoked).toBe(before.length);
  });

  it("lists each account once, with whether it has a password", async () => {
    const email = "listed@example.com";
    await signUpTestUser(app, email);

    const accounts = await listAccounts(tdb.db);
    const listed = accounts.filter((a) => a.email === email);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.hasPassword).toBe(true);
  });

  it("refuses an account with no credential row", async () => {
    const email = "nocred@example.com";
    await signUpTestUser(app, email);
    const target = resolveTarget(await listAccounts(tdb.db), email);

    // Simulate an external-provider-only user by removing the credential row.
    await tdb.db
      .delete(account)
      .where(and(eq(account.userId, target.userId), eq(account.providerId, "credential")));

    // The user must still appear from the LEFT join — an inner join would
    // make them vanish from the listing instead, which would also make
    // resolveTarget throw, but for the wrong reason ("no account with that
    // email" rather than "no password set").
    const accounts = await listAccounts(tdb.db);
    const listed = accounts.filter((a) => a.email === email);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.hasPassword).toBe(false);

    expect(() => resolveTarget(accounts, email)).toThrow(RecoveryError);
    expect(() => resolveTarget(accounts, email)).toThrow(/no password set/);
  });

  it("refuses a password longer than better-auth accepts", async () => {
    // Setting one would produce an account better-auth rejects at login — a
    // recovery tool that locks you out harder.
    const email = "toolong@example.com";
    await signUpTestUser(app, email);
    const target = resolveTarget(await listAccounts(tdb.db), email);

    // Derived from the actual configured maximum rather than hardcoded: that
    // coupling is the exact thing passwordBounds exists to avoid.
    const { max } = await passwordBounds(auth);
    await expect(resetPassword(tdb.db, auth, target, "x".repeat(max + 1))).rejects.toBeInstanceOf(
      RecoveryError,
    );

    const stillOriginal = await signIn(email, ORIGINAL_PASSWORD);
    expect(stillOriginal.status).toBe(200);
  });

  it("refuses a password shorter than better-auth accepts", async () => {
    const email = "tooshort@example.com";
    await signUpTestUser(app, email);
    const target = resolveTarget(await listAccounts(tdb.db), email);

    await expect(resetPassword(tdb.db, auth, target, "short")).rejects.toBeInstanceOf(
      RecoveryError,
    );
  });

  // passwordBounds exists so the CLI can never disagree with what better-auth
  // itself enforces. A version that returned hardcoded defaults would pass
  // every other test in this file, because none of them configure
  // non-default bounds — this one does, and checks passwordBounds reflects
  // them rather than the library's defaults.
  it("reads password bounds from better-auth's own configuration, not hardcoded defaults", async () => {
    const customAuth = betterAuth({
      baseURL: testEnv.AUTH_BASE_URL,
      secret: testEnv.BETTER_AUTH_SECRET,
      database: drizzleAdapter(tdb.db, { provider: "pg" }),
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
        maxPasswordLength: 64,
      },
    });

    // customAuth is intentionally a differently-shaped betterAuth() instance
    // (no trustedOrigins/databaseHooks, different emailAndPassword options) —
    // that's the whole point, it proves passwordBounds reads config rather
    // than assuming the app's own literal option shape. TypeScript's `Auth`
    // generic is invariant on that literal shape, so it can never structurally
    // match the app's `Auth` type; the cast reflects that this is a
    // deliberately different but still-valid better-auth instance, not a bug.
    await expect(passwordBounds(customAuth as unknown as typeof auth)).resolves.toEqual({
      min: 12,
      max: 64,
    });
  });

  // Reporting success when nothing was written would send someone away with a
  // password that does not work. This is the reliability failure, not a
  // destructive one: a wrong target matches zero rows, never all of them.
  it("refuses rather than reporting success when no credential row matches", async () => {
    const email = "vanished@example.com";
    await signUpTestUser(app, email);
    const target = resolveTarget(await listAccounts(tdb.db), email);

    // The credential disappears between listing and resetting.
    await tdb.db
      .delete(account)
      .where(and(eq(account.userId, target.userId), eq(account.providerId, "credential")));

    await expect(resetPassword(tdb.db, auth, target, NEW_PASSWORD)).rejects.toBeInstanceOf(
      RecoveryError,
    );
  });

  // The password write and the session revocation must stand or fall
  // together. This is checked by injecting a failure *between* the two
  // writes (after the UPDATE, during the DELETE) rather than before either
  // one runs — a fixture that fails before any write happens would pass even
  // if db.transaction were deleted entirely, and prove nothing about
  // atomicity.
  it("rolls back the password change when the session revocation fails", async () => {
    const email = "atomic@example.com";
    await signUpTestUser(app, email);
    const target = resolveTarget(await listAccounts(tdb.db), email);

    const sessionsBefore = await tdb.db
      .select()
      .from(session)
      .where(eq(session.userId, target.userId));
    expect(sessionsBefore.length).toBeGreaterThan(0);

    await expect(
      resetPassword(dbWithFailingDelete(tdb.db), auth, target, NEW_PASSWORD),
    ).rejects.toThrow("injected failure: session delete");

    // Checked before the sign-in below, which itself opens a new session and
    // would otherwise inflate the count: the failed DELETE must not have
    // removed the pre-existing sessions, proving the UPDATE rolled back with
    // it rather than leaving the password changed underneath live sessions.
    const sessionsAfter = await tdb.db
      .select()
      .from(session)
      .where(eq(session.userId, target.userId));
    expect(sessionsAfter.length).toBe(sessionsBefore.length);

    // Nothing moved: the old password still works.
    expect((await signIn(email, ORIGINAL_PASSWORD)).status).toBe(200);
  });
});
