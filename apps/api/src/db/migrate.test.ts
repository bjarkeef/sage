import { describe, it, expect } from "vitest";
import { runMigrations } from "./migrate";
import type { Database } from "./client";

describe("runMigrations", () => {
  it("no-ops when no migration journal exists", async () => {
    const db = {} as Database; // never touched on the no-op path
    await expect(runMigrations(db, "src/db/__no_such_migrations__")).resolves.toBeUndefined();
  });
});
