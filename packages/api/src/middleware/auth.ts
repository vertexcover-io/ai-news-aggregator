import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { MiddlewareHandler } from "hono";

// Accepts both `Authorization: Bearer <pw>` and a raw `Authorization: <pw>`.
// Dual-mode is intentional for the MVP — see auth.test.ts.
export function createPasswordAuth(password: string): MiddlewareHandler {
  const expected = Buffer.from(password, "utf8");
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!provided) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const providedBuf = Buffer.from(provided, "utf8");
    if (
      providedBuf.length !== expected.length ||
      !timingSafeEqual(providedBuf, expected)
    ) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
