import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { Database } from "../db/client";
import { account, session, user } from "../db/schema";
import type { Auth } from "../auth";

/** better-auth's provider id for email-and-password credentials. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * Characters a generated password may contain.
 *
 * Deliberately omits `l`, `I`, `O`, `0` and `1`: a generated password is read
 * off a terminal and retyped, and those are where that goes wrong. The lost
 * entropy is irrelevant at this length.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** One row of `sage list`: a user, and whether they have a password to reset. */
export interface AccountSummary {
  userId: string;
  email: string;
  createdAt: Date;
  hasPassword: boolean;
}

/**
 * The innermost cause of an error chain, or undefined if there is nothing safe
 * to print.
 *
 * This is the only thing the CLI is allowed to show for a database failure, and
 * the reason is specific: `DrizzleQueryError`'s constructor builds its message
 * as `Failed query: ${query}\nparams: ${params}`, and for {@link resetPassword}
 * the first bound parameter is the new password's `salt:hash`. Its `.stack`
 * begins with that same message, and `util.inspect` (what `console.error(err)`
 * uses) walks its `query`/`params` own properties, so every obvious way of
 * reporting the error writes the credential to the operator's terminal and
 * shell scrollback. The actual diagnosis -- `relation "user" does not exist`,
 * `connect ECONNREFUSED`, `password authentication failed` -- is only ever in
 * `.cause`.
 *
 * Returns undefined rather than the wrapper if the chain bottoms out at the
 * DrizzleQueryError itself (no cause, or a cycle). Failing closed costs a
 * diagnosis in a case that should not arise; failing open costs the password.
 * The real class is imported rather than duck-typed on purpose: if a drizzle
 * upgrade moves or renames it, this stops compiling instead of silently
 * reverting to leaking.
 */
export function rootCause(error: unknown): Error | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && current.cause !== undefined && !seen.has(current)) {
    seen.add(current);
    current = current.cause;
  }
  if (!(current instanceof Error)) return undefined;
  return current instanceof DrizzleQueryError ? undefined : current;
}

/** A refusal the operator should read, not a crash. The CLI prints the message
 *  and exits non-zero without a stack trace. */
export class RecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryError";
  }
}

/**
 * Every user on this instance, oldest first.
 *
 * Left-joined rather than inner-joined: a user with no credential row still
 * has to appear, because "you signed up with Google, there is no password to
 * reset" is the answer they need.
 */
export async function listAccounts(db: Database): Promise<AccountSummary[]> {
  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      createdAt: user.createdAt,
      password: account.password,
    })
    .from(user)
    .leftJoin(
      account,
      and(eq(account.userId, user.id), eq(account.providerId, CREDENTIAL_PROVIDER)),
    )
    .orderBy(user.createdAt);

  // One row per user even if the join ever widens.
  const byUser = new Map<string, AccountSummary>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    const hasPassword = row.password !== null;
    if (existing) {
      existing.hasPassword ||= hasPassword;
      continue;
    }
    byUser.set(row.userId, {
      userId: row.userId,
      email: row.email,
      createdAt: row.createdAt,
      hasPassword,
    });
  }
  return [...byUser.values()];
}

/**
 * Which account a reset applies to.
 *
 * Guessing is only acceptable when there is nothing to guess between — one
 * account and no argument. Anything else refuses and says how to find out,
 * because silently resetting the wrong person's password is unrecoverable
 * from the operator's point of view.
 */
export function resolveTarget(accounts: AccountSummary[], email?: string): AccountSummary {
  if (accounts.length === 0) {
    throw new RecoveryError(
      "There are no accounts on this instance yet. Sign up in the app first.",
    );
  }

  let target: AccountSummary;
  if (email === undefined) {
    if (accounts.length > 1) {
      throw new RecoveryError(
        `This instance has ${accounts.length} accounts. Say which one:\n` +
          `  sage reset-password <email>\n` +
          `Run 'sage list' to see them.`,
      );
    }
    target = accounts[0]!;
  } else {
    const wanted = email.trim().toLowerCase();
    const found = accounts.find((a) => a.email.toLowerCase() === wanted);
    if (!found) {
      throw new RecoveryError(
        `No account with the email '${email}'. Run 'sage list' to see the accounts on this instance.`,
      );
    }
    target = found;
  }

  if (!target.hasPassword) {
    throw new RecoveryError(
      `'${target.email}' has no password set — it was created through an external provider, ` +
        `so there is nothing to reset. Sign in the way you did originally.`,
    );
  }
  return target;
}

/** The password length limits better-auth itself enforces. Read at runtime so
 *  the CLI can never disagree with what the signup form accepts. */
export async function passwordBounds(auth: Auth): Promise<{ min: number; max: number }> {
  const ctx = await auth.$context;
  return {
    min: ctx.password.config.minPasswordLength,
    max: ctx.password.config.maxPasswordLength,
  };
}

/** A random password from {@link ALPHABET}. `randomInt` is uniform, which a
 *  `% ALPHABET.length` over random bytes would not be. */
export function generatePassword(length = 24): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * The length to hand {@link generatePassword} on the non-interactive path.
 *
 * 24 by default, but never outside what better-auth itself will accept. A
 * hardcoded 24 is only safe as long as nobody raises `minPasswordLength`
 * above it -- and once they do, `resetPassword` rejects the very password
 * this path just generated, on every single run, with no way to recover
 * from a script. Deriving it from {@link passwordBounds} instead means it
 * rises to the minimum when required and never exceeds the maximum.
 */
export function defaultPasswordLength({ min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(24, min), max);
}

/**
 * Sets a new password and ends every session the user has open.
 *
 * The hash comes from better-auth's own hasher, which is the whole point of
 * this module existing rather than a documented SQL snippet: the storage
 * format is better-auth's to change, and reproducing it by hand would rot
 * silently into accounts that cannot authenticate.
 *
 * Sessions are revoked because a reset that left them running would give false
 * comfort — anyone who knew the old password and holds a live session would
 * keep it.
 */
export async function resetPassword(
  db: Database,
  auth: Auth,
  target: AccountSummary,
  newPassword: string,
): Promise<{ sessionsRevoked: number }> {
  const { min, max } = await passwordBounds(auth);
  if (newPassword.length < min) {
    throw new RecoveryError(`Password must be at least ${min} characters.`);
  }
  if (newPassword.length > max) {
    throw new RecoveryError(`Password must be at most ${max} characters.`);
  }

  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(newPassword);

  // Both statements run in one transaction. Without it, a failure between them
  // leaves the password changed and the old sessions alive — precisely the
  // false comfort the revocation exists to prevent — while the operator is
  // told it worked.
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: hashed, updatedAt: new Date() })
      .where(and(eq(account.userId, target.userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
      .returning({ id: account.id });

    // Verified against Drizzle: a bad or undefined userId still emits
    // `user_id = $1` bound to null, which matches nothing — so the blast
    // radius of a wrong target is zero rows, never every row. But zero rows
    // reported as success is its own failure: it sends someone away with a
    // password that does not work and no reason why. Throwing here also rolls
    // back the transaction.
    if (updated.length === 0) {
      throw new RecoveryError(
        `Nothing was changed — no credential row matched '${target.email}'. ` +
          `The account may have been removed since the list was read. ` +
          `Run 'sage list' and try again.`,
      );
    }

    const revoked = await tx
      .delete(session)
      .where(eq(session.userId, target.userId))
      .returning({ id: session.id });

    return { sessionsRevoked: revoked.length };
  });
}
