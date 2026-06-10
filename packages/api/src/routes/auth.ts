/**
 * Auth routes (P3): POST /signup /login /logout /forgot /reset + GET /me.
 * Mounted at /api/auth OUTSIDE the cookie gate (these routes create the
 * session). All POST routes sit behind an in-memory per-IP token-bucket
 * rate limiter (REQ-121). Business logic lives in services/auth.ts
 * (S-api-03 — thin routes).
 */
import { Hono } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type {
  AuthMeResponse,
  SessionUser,
} from "@newsletter/shared/types/tenant";
import {
  signup,
  login,
  forgotPassword,
  resetPassword,
  signupSchema,
  loginSchema,
  forgotSchema,
  resetSchema,
  EmailInUseError,
  InvalidResetTokenError,
  type ResetTokenStore,
} from "@api/services/auth.js";
import type { UsersRepo, UserRow } from "@api/repositories/users.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import {
  issueToken,
  verifyToken,
  COOKIE_NAME,
  MAX_AGE_MS,
} from "@api/auth/session.js";
import { createRateLimiter } from "@api/auth/rate-limit.js";
import { captureAnalytics, identifyAnalytics } from "@api/lib/posthog.js";

export interface AuthRouterLogger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
}

export interface AuthRouterDeps {
  sessionSecret: string;
  getUsersRepo: () => UsersRepo;
  getTenantsRepo: () => TenantsRepo;
  resetTokenStore: ResetTokenStore;
  sendResetEmail: (email: string, resetUrl: string) => Promise<void>;
  /** Web origin used to build reset links (…/reset-password?token=). */
  webBaseUrl: string;
  logger: AuthRouterLogger;
  /** Injectable for tests; defaults to a 10-burst / 0.5 tok/s per-IP bucket. */
  rateLimiter?: MiddlewareHandler;
}

function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function setSessionCookie(
  c: Parameters<MiddlewareHandler>[0],
  deps: AuthRouterDeps,
  user: UserRow,
): void {
  const token = issueToken(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    deps.sessionSecret,
  );
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
    secure: process.env.NODE_ENV === "production",
  });
}

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const app = new Hono();
  const limiter =
    deps.rateLimiter ?? createRateLimiter({ capacity: 10, refillPerSecond: 0.5 });

  app.post("/signup", limiter, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_body",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        },
        400,
      );
    }
    try {
      const { user } = await signup(
        { usersRepo: deps.getUsersRepo() },
        parsed.data,
      );
      setSessionCookie(c, deps, user);
      deps.logger.info("auth_signup_ok", { userId: user.id });
      void identifyAnalytics({ distinctId: user.id });
      void captureAnalytics({ distinctId: user.id, event: "tenant_signed_up" });
      return c.json({ next: "onboarding", user: toSessionUser(user) }, 201);
    } catch (err) {
      if (err instanceof EmailInUseError) {
        return c.json({ error: "email_in_use" }, 409);
      }
      throw err;
    }
  });

  app.post("/login", limiter, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const user = await login({ usersRepo: deps.getUsersRepo() }, parsed.data);
    if (user === null) {
      deps.logger.warn("auth_login_failed", {
        ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown",
        timestamp: new Date().toISOString(),
      });
      return c.json({ error: "invalid_credentials" }, 401);
    }
    setSessionCookie(c, deps, user);
    deps.logger.info("auth_login_ok", { userId: user.id });
    void identifyAnalytics({ distinctId: user.id });
    void captureAnalytics({ distinctId: user.id, event: "admin_logged_in" });
    return c.json({ ok: true, user: toSessionUser(user) });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/forgot", limiter, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }
    await forgotPassword(
      {
        usersRepo: deps.getUsersRepo(),
        resetTokenStore: deps.resetTokenStore,
        sendResetEmail: deps.sendResetEmail,
        webBaseUrl: deps.webBaseUrl,
      },
      parsed.data.email,
    );
    // Identical body for known and unknown emails — no enumeration (REQ-004).
    return c.json({ ok: true });
  });

  app.post("/reset", limiter, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_body",
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        },
        400,
      );
    }
    try {
      await resetPassword(
        {
          usersRepo: deps.getUsersRepo(),
          resetTokenStore: deps.resetTokenStore,
        },
        parsed.data,
      );
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof InvalidResetTokenError) {
        return c.json({ error: "invalid_token" }, 400);
      }
      throw err;
    }
  });

  app.get("/me", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const payload = token ? verifyToken(token, deps.sessionSecret) : null;
    if (payload === null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const user = await deps.getUsersRepo().findById(payload.userId);
    if (user === null) {
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ error: "unauthorized" }, 401);
    }
    const tenant =
      user.tenantId !== null
        ? await deps.getTenantsRepo().findById(user.tenantId)
        : null;
    const response: AuthMeResponse = {
      user: toSessionUser(user),
      tenant:
        tenant !== null
          ? {
              id: tenant.id,
              slug: tenant.slug,
              name: tenant.name,
              status: tenant.status,
            }
          : null,
    };
    return c.json(response);
  });

  return app;
}
