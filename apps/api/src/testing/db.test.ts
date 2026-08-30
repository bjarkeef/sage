import { describe, it, expect } from "vitest";
import { testDbName } from "./db";

describe("testDbName", () => {
  it("does not collide when two workers are at the same sequence number", () => {
    // The bug this guards: the name was `sage_test_${process.pid}_${counter}`.
    // Vitest's default pool runs workers as worker_threads inside ONE process,
    // so every worker sees the same `process.pid`, while `counter` is per-worker
    // module state that restarts at 0. Two workers therefore both produced
    // `sage_test_<pid>_1`, and whichever lost the race died with
    // `database "sage_test_<pid>_1" already exists` -- a red suite in a
    // different, innocent test file on each run.
    expect(testDbName(1)).not.toBe(testDbName(1));
  });

  it("produces a legal, greppable identifier", () => {
    // Interpolated straight into `create database ${name}` with no quoting.
    expect(testDbName(2)).toMatch(/^sage_test_\d+_2_[0-9a-f]+$/);
  });
});
