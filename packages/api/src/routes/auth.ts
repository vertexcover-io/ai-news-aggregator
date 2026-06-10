import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { createLogger } from "@newsletter/shared";
import { issueSession, COOKIE_NAME, MAX_AGE_MS } from "@api/auth/session.js";
import { hashPassword, verifyPasswordHash } from "@api/services/password.js";
import type { UsersRepo } from "@api/repositories/users.js";
import type { TenantsRepo } from "@api/repositories/tenants.js";
import type { PasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    password: z.string().min(8).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

const forgotSchema = z.object({
  email: z.email().max(254),
});

const resetSchema = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(8).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });

export interface AuthRouterDeps {
  usersRepo: UsersRepo;
  tenantsRepo: TenantsRepo;
  passwordResetTokensRepo: PasswordResetTokensRepo;
  sessionSecret: string;
  webBaseUrl: string;
  sendPasswordResetEmail: (email: string, resetUrl: string) => Promise<void>;
  logger?: ReturnType<typeof createLogger>;
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(
  c: Context,
  secret: string,
  payload: { userId: string; tenantId: string; role: "tenant_admin" | "super_admin" },
): void {
  const token = issueSession(payload, secret);
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
  const logger = deps.logger ?? createLogger("api:auth");

  app.post("/signup", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await deps.usersRepo.getByEmail(normalizedEmail);
    if (existing) {
      logger.warn(
        { event: "signup.duplicate_email" },
        "signup: email already in use",
      );
      return c.json({ error: "email already in use" }, 409);
    }

    const tenant = await deps.tenantsRepo.create({
      slug: `pending-${randomBytes(8).toString("hex")}`,
      status: "pending_setup",
    });

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await deps.usersRepo.create({
        tenantId: tenant.id,
        email: normalizedEmail,
        name,
        passwordHash,
        // REQ-006: signup never assigns super_admin.
        role: "tenant_admin",
      });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "23505") {
        logger.warn(
          { event: "signup.race_duplicate" },
          "signup: concurrent insert lost the race",
        );
        return c.json({ error: "email already in use" }, 409);
      }
      throw err;
    }

    setSessionCookie(c, deps.sessionSecret, {
      userId: user.id,
      tenantId: tenant.id,
      role: "tenant_admin",
    });

    logger.info(
      { event: "signup.created", userId: user.id, tenantId: tenant.id },
      "signup: tenant_admin + tenant(pending_setup) created",
    );
    return c.json({ ok: true, tenantId: tenant.id }, 201);
  });

  app.post("/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const { email, password } = parsed.data;
    const user = await deps.usersRepo.getByEmail(email.toLowerCase());
    const valid =
      user !== null && (await verifyPasswordHash(user.passwordHash, password));

    if (!user || !valid) {
      logger.warn({ event: "login.failed" }, "login: invalid credentials");
      return c.json({ error: "invalid_credentials" }, 401);
    }

    setSessionCookie(c, deps.sessionSecret, {
      userId: user.id,
      tenantId: user.tenantId ?? "",
      role: user.role,
    });

    logger.info({ event: "login.ok", userId: user.id }, "login: ok");
    return c.json({ ok: true });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/forgot", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.usersRepo.getByEmail(email);

    // REQ-004: no enumeration — identical response for known/unknown email.
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await deps.passwordResetTokensRepo.create(user.id, tokenHash, expiresAt);

      const resetUrl = `${deps.webBaseUrl}/reset?token=${token}`;
      try {
        await deps.sendPasswordResetEmail(user.email, resetUrl);
        logger.info(
          { event: "forgot.sent", userId: user.id },
          "forgot: reset email sent",
        );
      } catch (err) {
        logger.warn(
          {
            event: "forgot.send_failed",
            userId: user.id,
            error: err instanceof Error ? err.message : String(err),
          },
          "forgot: reset email send failed (still returning ok)",
        );
      }
    } else {
      logger.info(
        { event: "forgot.unknown_email" },
        "forgot: unknown email, no-op (no enumeration)",
      );
    }

    return c.json({ ok: true });
  });

  app.post("/reset", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { token, password } = parsed.data;
    const tokenHash = hashResetToken(token);
    const record = await deps.passwordResetTokensRepo.findByHash(tokenHash);

    const isUsable =
      record !== null &&
      record.usedAt === null &&
      record.expiresAt.getTime() > Date.now();

    if (!record || !isUsable) {
      logger.warn(
        { event: "reset.invalid_token" },
        "reset: missing/used/expired token",
      );
      return c.json({ error: "invalid_or_expired_token" }, 400);
    }

    const passwordHash = await hashPassword(password);
    await deps.usersRepo.updatePassword(record.userId, passwordHash);
    await deps.passwordResetTokensRepo.markUsed(record.id);

    logger.info(
      { event: "reset.ok", userId: record.userId },
      "reset: password updated, token consumed",
    );
    return c.json({ ok: true });
  });

  return app;
}
