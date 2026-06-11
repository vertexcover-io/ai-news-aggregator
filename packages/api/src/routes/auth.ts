import { Hono } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  issueSessionToken,
  SESSION_COOKIE_NAME,
  MAX_AGE_MS,
} from "../auth/session.js";
import { requireAuth, getTenantCtx } from "../auth/middleware.js";
import { rateLimitAuth } from "../auth/rate-limit.js";
import { hashPassword, verifyPassword } from "../services/password.js";
import type { UsersRepo } from "../repositories/users.js";
import type { TenantsRepo } from "../repositories/tenants.js";
import { createHmac, randomBytes } from "node:crypto";

// ── Schemas ────────────────────────────────────────────────────────────

const signupSchema = z
  .object({
    name: z.string().min(1).max(255),
    email: z.email().max(255),
    password: z.string().min(8).max(128),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
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
});

// ── Reset token helpers ────────────────────────────────────────────────

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface ResetTokenEntry {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

// In-memory reset token store (per process)
const resetTokens = new Map<string, ResetTokenEntry>();

function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

function hashResetToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(`reset|${token}`).digest("hex");
}

function storeResetToken(userId: string, secret: string): string {
  // Clean up expired entries
  const now = Date.now();
  for (const [key, entry] of resetTokens) {
    if (entry.expiresAt < now) resetTokens.delete(key);
  }

  const raw = generateResetToken();
  const tokenHash = hashResetToken(raw, secret);
  resetTokens.set(tokenHash, {
    tokenHash,
    userId,
    expiresAt: now + RESET_TOKEN_TTL_MS,
    used: false,
  });

  // Return the raw token (to be sent in email)
  return raw;
}

function consumeResetToken(raw: string, secret: string): string | null {
  const tokenHash = hashResetToken(raw, secret);
  const entry = resetTokens.get(tokenHash);
  if (!entry) return null;
  if (entry.used) return null;
  if (entry.expiresAt < Date.now()) {
    resetTokens.delete(tokenHash);
    return null;
  }
  entry.used = true;
  resetTokens.set(tokenHash, entry);
  return entry.userId;
}

// ── Router deps ────────────────────────────────────────────────────────

export interface AuthRouterDeps {
  sessionSecret: string;
  usersRepo: UsersRepo;
  tenantsRepo: TenantsRepo;
  /**
   * Called when a reset token is generated. Sends the raw token to the user.
   * In production, this sends an email. In tests, this is a no-op or spy.
   */
  sendResetEmail?: (email: string, token: string) => Promise<void>;
}

// ── Router ─────────────────────────────────────────────────────────────

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const app = new Hono();

  // Rate limit all auth routes
  app.use("*", rateLimitAuth());

  // ── POST /signup ────────────────────────────────────────────────────

  app.post("/signup", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation_failed", details: parsed.error.issues }, 400);
    }

    const { name, email, password } = parsed.data;

    // Check duplicate email
    const existing = await deps.usersRepo.findByEmail(email);
    if (existing) {
      return c.json({ error: "email_already_in_use" }, 409);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create tenant first (pending_setup)
    const slug = `tenant-${randomBytes(4).toString("hex")}`;
    const tenant = await deps.tenantsRepo.create({
      slug,
      name,
      status: "pending_setup",
    });

    // Create user as tenant_admin
    // REQ-006: role is always "tenant_admin" — never read from request body
    const user = await deps.usersRepo.create({
      email,
      name,
      passwordHash,
      role: "tenant_admin",
      tenantId: tenant.id,
    });

    // Issue session token and set cookie
    const token = issueSessionToken(deps.sessionSecret, {
      userId: user.id,
      tenantId: tenant.id,
      role: "tenant_admin",
    });

    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });

    return c.json({ next: "onboarding" }, 201);
  });

  // ── POST /login ─────────────────────────────────────────────────────

  app.post("/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const { email, password } = parsed.data;

    const user = await deps.usersRepo.findByEmail(email);
    if (!user) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    // User must have a tenant
    if (!user.tenantId) {
      return c.json({ error: "account_not_configured" }, 500);
    }

    const token = issueSessionToken(deps.sessionSecret, {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });

    return c.json({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  });

  // ── POST /logout ────────────────────────────────────────────────────

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    deleteCookie(c, "admin_session", { path: "/" });
    return c.json({ ok: true });
  });

  // ── POST /forgot ────────────────────────────────────────────────────

  app.post("/forgot", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      // Return 200 even on validation failure to avoid enumeration
      return c.json({ ok: true });
    }

    const { email } = parsed.data;
    const user = await deps.usersRepo.findByEmail(email);

    // Always return 200 — no enumeration
    if (user) {
      const rawToken = storeResetToken(user.id, deps.sessionSecret);

      // Send email if configured
      if (deps.sendResetEmail) {
        await deps.sendResetEmail(email, rawToken).catch(() => {
          // Email failure is non-fatal — user can retry
        });
      }
    }

    return c.json({ ok: true });
  });

  // ── POST /reset ─────────────────────────────────────────────────────

  app.post("/reset", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation_failed", details: parsed.error.issues }, 400);
    }

    const { token, password } = parsed.data;

    const userId = consumeResetToken(token, deps.sessionSecret);
    if (!userId) {
      return c.json({ error: "invalid_or_expired_token" }, 400);
    }

    const passwordHash = await hashPassword(password);
    await deps.usersRepo.updatePassword(userId, passwordHash);

    return c.json({ ok: true });
  });

  // ── GET /me ────────────────────────────────────────────────────────

  app.get("/me", requireAuth(deps.sessionSecret), (c) => {
    const ctx = getTenantCtx(c);
    return c.json({
      authenticated: true,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
    });
  });

  return app;
}
