import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  issueToken,
  verifyPassword,
  COOKIE_NAME,
  MAX_AGE_MS,
} from "../auth/session.js";
import { captureAnalytics, identifyAnalytics } from "@api/lib/posthog.js";

const loginSchema = z.object({ password: z.string().min(1) });

export interface AdminRouterLogger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
}

export interface AdminRouterOptions {
  adminPassword: string;
  sessionSecret: string;
  logger: AdminRouterLogger;
}

export function createAdminRouter(opts: AdminRouterOptions): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const ok = verifyPassword(parsed.data.password, opts.adminPassword);
    if (!ok) {
      const ip =
        c.req.header("x-forwarded-for") ??
        c.req.header("x-real-ip") ??
        "unknown";
      const ua = c.req.header("user-agent") ?? "unknown";
      opts.logger.warn("admin_login_failed", {
        ip,
        ua,
        timestamp: new Date().toISOString(),
      });
      return c.json({ error: "invalid_password" }, 401);
    }

    const token = issueToken(opts.sessionSecret);
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });
    opts.logger.info("admin_login_ok", {
      timestamp: new Date().toISOString(),
    });
    void identifyAnalytics({ distinctId: "admin" });
    void captureAnalytics({ distinctId: "admin", event: "admin_logged_in" });
    return c.json({ ok: true });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/me", (c) => {
    const ctx = c.get("tenantCtx") as { role?: string; impersonating?: boolean; originalRole?: string } | undefined;
    const role = ctx?.role ?? "tenant_admin";
    if (ctx?.impersonating) {
      // Phase 6: return impersonation info so the frontend can show the banner
      return c.json({
        admin: true,
        role,
        impersonating: true,
      });
    }
    return c.json({ admin: true, role });
  });

  return app;
}
