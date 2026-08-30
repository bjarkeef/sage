import { describe, it, expect } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  it("returns a drizzle db and a raw sql handle without connecting", async () => {
    const { db, sql } = createDb("postgres://sage:sage@localhost:5432/sage");
    expect(db).toBeTypeOf("object");
    expect(sql).toBeTypeOf("function");
    await sql.end();
  });
});
