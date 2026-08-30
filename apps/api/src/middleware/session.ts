import type { MiddlewareHandler } from "hono";
import type { Auth } from "../auth";

export type AppEnv = {
  Variables: {
    user: { id: string };
    session: Record<string, unknown>;
  };
};

export function sessionMiddleware(auth: Auth): MiddlewareHandler {
  return async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user", result.user);
    c.set("session", result.session);
    await next();
  };
}
