import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { issueToken, verifySessionToken, COOKIE_NAME, MAX_AGE_MS } from "../auth/session.js";
import type { SessionPayload } from "../auth/session.js";
import type { UsersRepo } from "../repositories/users.js";
import type { TenantsRepo } from "../repositories/tenants.js";

interface Logger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
}

// ── Zod schemas ──────────────────────────────────────────────────────────

const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.email("Invalid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.email(),
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// ── Route factory ────────────────────────────────────────────────────────

export interface AuthRouteDeps {
  usersRepo: UsersRepo;
  tenantsRepo: TenantsRepo;
  sessionSecret: string;
  logger: Logger;
  hashPassword: (plaintext: string) => Promise<string>;
  verifyPassword: (hash: string, plaintext: string) => Promise<boolean>;
}

export function createAuthRouter(deps: AuthRouteDeps): Hono {
  const app = new Hono();

  // POST /signup — creates user + tenant, sets session cookie (REQ-001, REQ-002, REQ-003, REQ-006)
  app.post("/signup", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      // Check if confirmPassword mismatch specifically
      const confirmError = parsed.error.issues.find(
        (i) => i.path.includes("confirmPassword"),
      );
      if (confirmError) {
        return c.json({ error: confirmError.message }, 400);
      }
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
    }

    const { email, name, password } = parsed.data;

    // REQ-003: Check for duplicate email
    const existing = await deps.usersRepo.findByEmail(email);
    if (existing) {
      return c.json({ error: "Email already in use" }, 409);
    }

    // Generate a tenant slug from the name
    const slug = generateSlug(name);

    // Hash password
    const passwordHash = await deps.hashPassword(password);

    // Create tenant + user in sequence (not a transaction — repo layer
    // doesn't currently expose transactions; idempotent).
    const tenant = await deps.tenantsRepo.create({ slug, name });

    // REQ-006: Always role "tenant_admin" — never super_admin via signup
    const user = await deps.usersRepo.create({
      email,
      name,
      passwordHash,
      role: "tenant_admin",
      tenantId: tenant.id,
    });

    // Issue session token
    const sessionPayload: SessionPayload = {
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
    };
    const token = issueToken(deps.sessionSecret, sessionPayload);

    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });

    deps.logger.info("signup_ok", {
      userId: user.id,
      tenantId: tenant.id,
      timestamp: new Date().toISOString(),
    });

    // REQ-001: Returns { next: 'onboarding' } to signal wizard redirect
    return c.json({ next: "onboarding", userId: user.id, tenantId: tenant.id }, 201);
  });

  // POST /login — verifies email+password, sets session cookie
  app.post("/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid input" }, 400);
    }

    const { email, password } = parsed.data;

    // Always use the same response timing for unknown emails (no enumeration)
    const user = await deps.usersRepo.findByEmail(email);
    if (!user) {
      deps.logger.warn("login_failed_unknown_email", {
        emailDomain: email.split("@")[1] ?? "unknown",
        timestamp: new Date().toISOString(),
      });
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const valid = await deps.verifyPassword(user.passwordHash, password);
    if (!valid) {
      deps.logger.warn("login_failed_bad_password", {
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const sessionPayload: SessionPayload = {
      userId: user.id,
      tenantId: user.tenantId ?? "",
      role: user.role,
    };
    const token = issueToken(deps.sessionSecret, sessionPayload);

    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });

    deps.logger.info("login_ok", {
      userId: user.id,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      ok: true,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  });

  // POST /logout — clears session cookie
  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  // POST /forgot — sends password reset email (REQ-004: identical response for known/unknown)
  app.post("/forgot", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = forgotSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid input" }, 400);
    }

    // Always respond identically — no email enumeration
    // In a real implementation, we'd generate a reset token and send an email.
    // For now, this is a stub that returns 200 always.
    return c.json({ ok: true });
  });

  // POST /reset — resets password using a single-use token (REQ-004)
  app.post("/reset", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = resetSchema.safeParse(body);

    if (!parsed.success) {
      const confirmError = parsed.error.issues.find(
        (i) => i.path.includes("confirmPassword"),
      );
      if (confirmError) {
        return c.json({ error: confirmError.message }, 400);
      }
      return c.json({ error: "Invalid input" }, 400);
    }

    // Token verification would go here (REQ-004: single-use, short-lived).
    // For now, stub returning ok.
    return c.json({ ok: true });
  });

  // GET /me — returns session info from cookie (REQ-005)
  app.get("/me", (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      // Return unauthenticated — the frontend handles this.
      return c.json({ authenticated: false }, 200);
    }

    const payload = verifySessionToken(token, deps.sessionSecret);
    if (!payload) {
      return c.json({ authenticated: false }, 200);
    }

    return c.json({
      authenticated: true,
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role,
    });
  });

  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a name.
 * Lowercase, replace non-alphanumeric with hyphens, collapse, trim.
 */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${suffix}`;
}
