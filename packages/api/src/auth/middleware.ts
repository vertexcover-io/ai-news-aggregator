import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthContext } from "@newsletter/shared";
import { verifySession, COOKIE_NAME, type SessionClaims } from "./session.js";

export interface AuthEnv {
  Variables: { auth: AuthContext };
}

function claimsFrom(c: Context, secret: string): SessionClaims | null {
  const token = getCookie(c, COOKIE_NAME);
  return token ? verifySession(token, secret) : null;
}

function toAuthContext(claims: SessionClaims): AuthContext {
  return {
    userId: claims.uid,
    role: claims.role,
    tenantId: claims.imp ?? claims.tid,
    realTenantId: claims.tid,
    impersonating: claims.imp !== undefined,
  };
}

export function requireUser(secret: string): MiddlewareHandler<AuthEnv> {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const claims = claimsFrom(c, secret);
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    c.set("auth", toAuthContext(claims));
    await next();
  });
}

export function requireSuperAdmin(secret: string): MiddlewareHandler<AuthEnv> {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const claims = claimsFrom(c, secret);
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    if (claims.role !== "super_admin") {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("auth", toAuthContext(claims));
    await next();
  });
}
