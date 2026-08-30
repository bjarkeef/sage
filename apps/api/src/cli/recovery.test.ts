import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import {
  generatePassword,
  defaultPasswordLength,
  resolveTarget,
  rootCause,
  RecoveryError,
  type AccountSummary,
} from "./recovery";

const NOW = new Date();

function acct(email: string, hasPassword = true): AccountSummary {
  return { userId: `id-${email}`, email, createdAt: NOW, hasPassword };
}

describe("generatePassword", () => {
  it("produces the requested length", () => {
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("omits characters that are ambiguous when read aloud or copied", () => {
    // A generated password gets read off a screen and retyped; l/1/I/O/0 are
    // where that goes wrong.
    const generated = Array.from({ length: 40 }, () => generatePassword(32)).join("");
    expect(generated).not.toMatch(/[lIO01]/);
  });

  it("differs between calls", () => {
    expect(generatePassword(24)).not.toBe(generatePassword(24));
  });
});

describe("defaultPasswordLength", () => {
  it("keeps the 24-character default when the configured bounds allow it", () => {
    expect(defaultPasswordLength({ min: 8, max: 128 })).toBe(24);
  });

  it("rises to the minimum when the default would fall below it", () => {
    expect(defaultPasswordLength({ min: 32, max: 64 })).toBe(32);
  });

  it("never exceeds the maximum", () => {
    expect(defaultPasswordLength({ min: 4, max: 12 })).toBe(12);
  });

  // The bug this guards: `generatePassword()` called with no argument always
  // produces 24 characters. With `minPasswordLength: 32` configured,
  // resetPassword() then rejects every password the non-interactive path
  // generates, forever -- there is no way to recover from a script. A
  // hardcoded 24 here would pass every other test in this file, because none
  // of them raise the minimum above it; this is the one that would catch it,
  // by checking the *generated password itself* against better-auth's own
  // bounds rather than a hardcoded number.
  it("produces a generated password that satisfies a raised minimum, not a hardcoded 24", () => {
    const bounds = { min: 32, max: 40 };
    const generated = generatePassword(defaultPasswordLength(bounds));
    expect(generated.length).toBeGreaterThanOrEqual(bounds.min);
    expect(generated.length).toBeLessThanOrEqual(bounds.max);
  });
});

describe("rootCause", () => {
  // The shape drizzle actually throws: pg-core/session.ts wraps every failure
  // as `new DrizzleQueryError(queryString, params, e)`. Built here from the
  // real class rather than a stand-in, because what is being asserted is a
  // property of drizzle's own error, and a hand-rolled fake would keep passing
  // after an upgrade changed it.
  const HASH = "2cd18048d5f4125eff3f8ac6a988bc2a:353a77734dc634ecb2b3d81d1bfe4921";
  function failedReset(cause: Error | undefined): DrizzleQueryError {
    return new DrizzleQueryError(
      'update "account" set "password" = $1, "updated_at" = $2 where (...) returning "id"',
      [HASH, "2026-08-15T13:06:05.243Z", "user-1", "credential"],
      cause,
    );
  }

  it("reports the underlying failure, not the query that carried the password", () => {
    // The bug this guards: printing the DrizzleQueryError's own message (or
    // its stack, which starts with that message) writes the new password's
    // salt:hash to the operator's terminal and shell scrollback.
    const message = rootCause(failedReset(new Error('relation "user" does not exist')))?.message;
    expect(message).toBe('relation "user" does not exist');
    expect(message).not.toContain("params:");
    expect(message).not.toContain(HASH);
  });

  it("returns nothing rather than the wrapper when the chain has no cause", () => {
    // Failing closed: there is no diagnosis to salvage here, and the only
    // thing left to print is the message carrying the hash.
    expect(rootCause(failedReset(undefined))).toBeUndefined();
  });

  it("walks past intermediate wrappers to the innermost error", () => {
    const inner = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const outer = new Error("outer", { cause: failedReset(inner) });
    expect(rootCause(outer)).toBe(inner);
  });

  it("passes an ordinary error through untouched", () => {
    const plain = new TypeError("cannot read properties of undefined");
    expect(rootCause(plain)).toBe(plain);
  });

  it("gives up on anything that is not an error", () => {
    expect(rootCause("just a string")).toBeUndefined();
    expect(rootCause(new Error("wrapped", { cause: "a string cause" }))).toBeUndefined();
  });

  it("terminates on a cyclic cause chain", () => {
    const cyclic = new Error("round and round");
    cyclic.cause = cyclic;
    expect(rootCause(cyclic)).toBe(cyclic);
  });
});

describe("resolveTarget", () => {
  it("uses the only account when no email is given", () => {
    const only = acct("solo@example.com");
    expect(resolveTarget([only])).toBe(only);
  });

  it("refuses to guess when several accounts exist and no email is given", () => {
    expect(() => resolveTarget([acct("a@example.com"), acct("b@example.com")])).toThrow(
      RecoveryError,
    );
  });

  it("refuses when there are no accounts at all", () => {
    expect(() => resolveTarget([])).toThrow(RecoveryError);
  });

  it("finds an account by email regardless of case", () => {
    const target = acct("Mixed@Example.com");
    expect(resolveTarget([target], "mixed@example.com")).toBe(target);
  });

  it("refuses an email that does not exist", () => {
    expect(() => resolveTarget([acct("a@example.com")], "ghost@example.com")).toThrow(
      RecoveryError,
    );
  });

  it("refuses an account that has no password to reset", () => {
    // An OAuth-only user has no credential row. Pretending to reset their
    // password would leave them exactly as locked out, with no explanation.
    expect(() => resolveTarget([acct("oauth@example.com", false)], "oauth@example.com")).toThrow(
      RecoveryError,
    );
  });
});
