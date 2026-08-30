import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { sessionMiddleware, type AppEnv } from "./session";
import type { Auth } from "../auth";

function fakeAuth(session: unknown): Auth {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(session),
    },
    handler: vi.fn(),
  } as unknown as Auth;
}

describe("sessionMiddleware", () => {
  it("returns 401 when no session exists", async () => {
    const auth = fakeAuth(null);
    const app = new Hono<AppEnv>();
    app.use("*", sessionMiddleware(auth));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("sets user and session on context when authenticated", async () => {
    const mockSession = {
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      session: { id: "sess-1", token: "tok", userId: "user-1" },
    };
    const auth = fakeAuth(mockSession);
    const app = new Hono<AppEnv>();
    app.use("*", sessionMiddleware(auth));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ userId: user.id });
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1" });
  });
});
