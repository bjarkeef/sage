/**
 * Operator CLI for a locked-out self-hoster.
 *
 * Sage sends no email, so better-auth's forgot-password flow is inert. Recovery
 * runs through the one thing the owner of a self-hosted instance always has:
 * a shell on the box. Documented in docs/DEPLOYMENT.md.
 *
 * Every decision and database write lives in ./cli/recovery.ts, which is
 * testable without a terminal. This file is argument parsing, prompting and
 * printing — the parts that need a TTY and are verified by hand.
 */
import { createDb, type Database } from "./db/client";
import { createAuth, type Auth } from "./auth";
import { parseEnv } from "./env";
import {
  listAccounts,
  resolveTarget,
  resetPassword,
  passwordBounds,
  generatePassword,
  defaultPasswordLength,
  rootCause,
  RecoveryError,
  type AccountSummary,
} from "./cli/recovery";

const USAGE = `sage — Sage operator commands

  sage list                       List the accounts on this instance
  sage reset-password [email]     Set a new password for an account

The email may be omitted when the instance has exactly one account.

Sage sends no email, so a forgotten password is recovered here rather than from
the app. Resetting a password also signs that user out everywhere.

With a terminal (docker compose exec -it), you are prompted for the new password
and nothing is echoed. Without one, a strong password is generated and printed.
A password is never accepted as an argument — it would be saved in your shell
history.
`;

/** Reads a line without echoing it. Raw mode rather than a readline internal,
 *  so this does not depend on Node's private API surface. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const cleanup = () => {
      clearTimeout(timer);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("error", onError);
    };

    // 120s is ample time for a human to type a password. This guards the
    // likeliest real-world hang: `docker compose exec -t` (missing the `i`)
    // still allocates a pty, so both isTTY checks in `run` pass and this
    // interactive branch runs -- but the client never forwards stdin, so no
    // data and no EOF ever arrive, and without this the prompt would wait
    // forever.
    const timer = setTimeout(() => {
      cleanup();
      process.stdout.write("\n");
      reject(
        new RecoveryError(
          "No input received after 120 seconds. If you are using docker compose exec, " +
            "make sure you passed -it (not just -t) so your keyboard is connected. Nothing was changed.",
        ),
      );
    }, 120_000);

    // EOF mid-prompt (piped input running out, or the remote end of a
    // docker exec session closing) would otherwise leave this promise
    // unsettled forever: raw mode stuck on, the listener still attached,
    // and main()'s finally never runs -- so the database connection is
    // never closed either.
    const onEnd = () => {
      cleanup();
      process.stdout.write("\n");
      reject(new RecoveryError("Input ended unexpectedly. Nothing was changed."));
    };

    // An "error" event on stdin would otherwise become an uncaught
    // exception that bypasses this promise -- and cleanup -- entirely.
    const onError = (error: Error) => {
      cleanup();
      reject(new RecoveryError(`Reading input failed: ${error.message}. Nothing was changed.`));
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        // \u0003 is Ctrl-C and \u007f is DEL (what most terminals send
        // for backspace). These MUST stay as escape sequences: a literal
        // control character is invisible in an editor and compares as an
        // empty string, so the branch would silently never fire.
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C
          cleanup();
          process.stdout.write("\n");
          reject(new RecoveryError("Cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        // Every other C0 control character is dropped rather than appended.
        // Ctrl-D is the important case: on a cooked terminal it means EOF,
        // but raw mode never turns it into an "end" event -- it just
        // arrives here as the literal byte U+0004. Ctrl-D is the
        // conventional "I'm done typing" key, so a user pressing it out of
        // habit at both prompts would otherwise set a password containing
        // an unprintable byte the web login form can never send back -- and
        // the confirm prompt cannot catch it, because they type the same
        // byte consistently both times. Arrow keys are a milder version of
        // the same problem: their leading escape byte is dropped here too.
        if (ch.codePointAt(0)! < 0x20) {
          continue;
        }
        value += ch;
      }
    };
    stdin.on("data", onData);
    stdin.once("end", onEnd);
    stdin.once("error", onError);
  });
}

/** Host and database name, never credentials. Printed before any write so a
 *  reset cannot land on the wrong instance unnoticed. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const [command, argument, ...extra] = process.argv.slice(2);

  // No command at all is a usage error (exit 1), so its usage text is a
  // diagnostic and belongs on stderr -- otherwise `sage > out.txt` swallows
  // it. `--help` and friends are a successful, requested response (exit 0),
  // so that one goes to stdout as normal output.
  if (command === undefined) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command !== "list" && command !== "reset-password") {
    process.stderr.write(`Unknown command '${command}'.\n\n${USAGE}`);
    return 1;
  }
  if (command === "list" && argument !== undefined) {
    process.stderr.write(`'sage list' takes no arguments.\n\n${USAGE}`);
    return 1;
  }
  // Silently dropping extra positions would let `sage reset-password
  // a@b.com hunter2` quietly ignore "hunter2" -- which is now sitting in the
  // user's shell history anyway. Refusing outright is the better teaching
  // moment: a password is never accepted as a command-line argument.
  if (extra.length > 0) {
    process.stderr.write(
      `Too many arguments. A password is never accepted as an argument -- it would be saved ` +
        `in your shell history.\n\n${USAGE}`,
    );
    return 1;
  }

  // parseEnv throws a readable aggregated message, but as a plain Error it
  // would print with a stack trace. Someone who is already locked out should
  // get the sentence, not the trace.
  let env: ReturnType<typeof parseEnv>;
  try {
    env = parseEnv();
  } catch (error) {
    throw new RecoveryError(
      `${error instanceof Error ? error.message : String(error)}\n\n` +
        `Set DATABASE_URL (and the other required variables) before running this command.`,
    );
  }

  // One connection: this is a short-lived command, and a CLI has no business
  // taking a pool's worth of slots from a small Postgres.
  const { db, sql } = createDb(env.DATABASE_URL, 1);
  try {
    // Inside the try: a throw here would otherwise leak `sql` unclosed,
    // since it happened before the finally that closes it was in scope.
    const auth = createAuth(db, env);
    return await run(db, auth, env, command, argument);
  } finally {
    // Closing lets the process end on its own, which is what makes it safe to
    // avoid process.exit() below.
    await sql.end({ timeout: 5 });
  }
}

/** Everything that needs a database. Split out so `main` can own the
 *  connection's lifetime with a single try/finally. */
async function run(
  db: Database,
  auth: Auth,
  env: ReturnType<typeof parseEnv>,
  command: "list" | "reset-password",
  argument: string | undefined,
): Promise<number> {
  let accounts: AccountSummary[];
  try {
    accounts = await listAccounts(db);
  } catch (error) {
    throw new RecoveryError(
      `Could not read from the database at ${describeDatabase(env.DATABASE_URL)}.\n` +
        `${rootCause(error)?.message ?? "unknown error"}\n\n` +
        // The line above is the diagnosis; this one has to fit all three of
        // the failures that reach here -- unreachable database, wrong
        // credentials, and migrations never applied -- because it is printed
        // without knowing which one it was.
        `Check that the database is running, that DATABASE_URL points at it, and\n` +
        `that migrations have been applied. Inside Compose: docker compose ps`,
    );
  }

  if (command === "list") {
    if (accounts.length === 0) {
      process.stdout.write("No accounts yet. Create one by signing up in the app.\n");
      return 0;
    }
    const width = Math.max(...accounts.map((a) => a.email.length), "EMAIL".length);
    process.stdout.write(`${"EMAIL".padEnd(width)}  CREATED     PASSWORD\n`);
    for (const a of accounts) {
      process.stdout.write(
        `${a.email.padEnd(width)}  ${formatDate(a.createdAt)}  ${a.hasPassword ? "yes" : "no"}\n`,
      );
    }
    return 0;
  }

  const target = resolveTarget(accounts, argument);
  process.stdout.write(`Database: ${describeDatabase(env.DATABASE_URL)}\n`);
  process.stdout.write(`Account:  ${target.email}\n\n`);

  const { min, max } = await passwordBounds(auth);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let password: string;
  let generated = false;

  if (interactive) {
    let chosen: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const first = await promptHidden(`New password (${min}-${max} characters): `);
      if (first.length < min || first.length > max) {
        process.stderr.write(`Password must be ${min}-${max} characters.\n`);
        continue;
      }
      const second = await promptHidden("Confirm new password: ");
      if (first !== second) {
        process.stderr.write("Passwords did not match.\n");
        continue;
      }
      chosen = first;
      break;
    }
    if (chosen === null) {
      throw new RecoveryError("Gave up after three attempts. Nothing was changed.");
    }
    password = chosen;
  } else {
    password = generatePassword(defaultPasswordLength({ min, max }));
    generated = true;
  }

  const { sessionsRevoked } = await resetPassword(db, auth, target, password);

  if (generated) {
    process.stdout.write(`Generated password: ${password}\n\n`);
    process.stdout.write("Sign in with it, then change it to something you will remember.\n");
  } else {
    process.stdout.write("Password updated.\n");
  }
  if (sessionsRevoked > 0) {
    process.stdout.write(
      `Signed out of ${sessionsRevoked} existing ${sessionsRevoked === 1 ? "session" : "sessions"}.\n`,
    );
  }
  return 0;
}

// `process.exitCode`, never `process.exit()`. Node's docs are explicit that
// exit() abandons pending writes to stdout, and the one output that must never
// be truncated is a generated password — a half-printed one leaves someone
// locked out holding a credential they cannot read. Setting the code and
// letting the event loop drain is free, because main() closes the database
// connection in its finally and nothing else keeps the process alive.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // A refusal is something to read, not a stack trace to decode. Anything
    // else is a genuine fault and gets diagnosed from its root cause.
    if (error instanceof RecoveryError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      // Never the outer error's .message, .stack, or the object itself.
      // Drizzle wraps failures in a DrizzleQueryError whose MESSAGE (and so
      // whose STACK, which starts with the message) embeds the SQL and its
      // bound parameters -- for resetPassword that is the new password's
      // *hash*. console.error(error) would fare no better: util.inspect
      // walks every enumerable own property and would print the same query
      // and params. The actual diagnosis (`relation "user" does not exist`,
      // `connect ECONNREFUSED`) lives in `.cause`, which is what rootCause
      // reads instead.
      const cause = rootCause(error);
      console.error(cause?.message ?? "An unexpected error occurred. Nothing was changed.");
    }
    process.exitCode = 1;
  });
