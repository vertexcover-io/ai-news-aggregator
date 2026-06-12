import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type {
  EmailProvider,
  MeResponse,
  SessionUser,
  SignupResponse,
  UserSelect,
} from "@newsletter/shared";
import {
  issueSession,
  COOKIE_NAME,
  MAX_AGE_MS,
  type SessionClaims,
} from "@api/auth/session.js";
import { requireUser, type AuthEnv } from "@api/auth/middleware.js";
import { hashPassword, verifyPassword } from "@api/lib/password.js";
import { renderPasswordReset } from "@api/lib/email/templates/index.js";
import { captureAnalytics, identifyAnalytics } from "@api/lib/posthog.js";
import {
  EmailInUseError,
  type UsersRepo,
} from "@api/repositories/users.js";
import type { PasswordResetTokensRepo } from "@api/repositories/password-reset-tokens.js";

export const AUTH_RATE_LIMITS = {
  signup: { windowSeconds: 15 * 60, max: 10 },
  login: { windowSeconds: 15 * 60, max: 20 },
  forgotPassword: { windowSeconds: 15 * 60, max: 10 },
  resetPassword: { windowSeconds: 15 * 60, max: 10 },
} as const;

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// bcrypt cost-12 hash of a discarded random preimage. Verified against on
// login when the email is unknown so both branches pay the same bcrypt cost
// (no timing-based account enumeration).
const DUMMY_PASSWORD_HASH =
  "$2b$12$Yx8MuHKStE4iMOUu9cGB9.fK.u1qFWUPYIBj0onur9UdyGAFu3KB.";

const passwordSchema = z.string().min(8).max(200);

const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((body) => body.password === body.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({ email: z.email().max(320) });

const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((body) => body.password === body.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });

export interface AuthRouterLogger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
}

export interface AuthRouterDeps {
  sessionSecret: string;
  getUsersRepo: () => UsersRepo;
  getResetTokensRepo: () => PasswordResetTokensRepo;
  emailProvider: Pick<EmailProvider, "send">;
  fromEmail: string;
  webBaseUrl: string;
  logger?: AuthRouterLogger;
  limiters?: {
    signup?: MiddlewareHandler;
    login?: MiddlewareHandler;
    forgotPassword?: MiddlewareHandler;
    resetPassword?: MiddlewareHandler;
  };
  /** Seam for work that must not delay the response (REQ-004 timing).
   * Defaults to fire-and-forget; tests inject a collector to await tasks. */
  runInBackground?: (task: Promise<void>) => void;
}

function toSessionUser(user: UserSelect): SessionUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const app = new Hono();
  const logger = deps.logger;

  const setSessionCookie = (
    c: Parameters<MiddlewareHandler>[0],
    claims: Omit<SessionClaims, "iat">,
  ): void => {
    setCookie(c, COOKIE_NAME, issueSession(claims, deps.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
      secure: process.env.NODE_ENV === "production",
    });
  };

  if (deps.limiters?.signup) app.use("/signup", deps.limiters.signup);
  if (deps.limiters?.login) app.use("/login", deps.limiters.login);
  if (deps.limiters?.forgotPassword) {
    app.use("/forgot-password", deps.limiters.forgotPassword);
  }
  if (deps.limiters?.resetPassword) {
    app.use("/reset-password", deps.limiters.resetPassword);
  }

  app.post("/signup", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", fields: z.flattenError(parsed.error).fieldErrors },
        400,
      );
    }

    const usersRepo = deps.getUsersRepo();
    const email = parsed.data.email.toLowerCase();
    const existing = await usersRepo.findByEmail(email);
    if (existing) return c.json({ error: "email already in use" }, 409);

    const passwordHash = await hashPassword(parsed.data.password);
    let created: Awaited<ReturnType<UsersRepo["createTenantAdminWithTenant"]>>;
    try {
      created = await usersRepo.createTenantAdminWithTenant({
        name: parsed.data.name,
        email,
        passwordHash,
      });
    } catch (err) {
      if (err instanceof EmailInUseError) {
        return c.json({ error: "email already in use" }, 409);
      }
      throw err;
    }

    setSessionCookie(c, {
      uid: created.user.id,
      tid: created.user.tenantId,
      role: created.user.role,
    });
    logger?.info("signup_ok", { userId: created.user.id });
    void identifyAnalytics({ distinctId: created.user.id });
    void captureAnalytics({
      distinctId: created.user.id,
      event: "user_signed_up",
    });
    const response: SignupResponse = {
      user: toSessionUser(created.user),
      tenant: { id: created.tenant.id, status: created.tenant.status },
    };
    return c.json(response, 201);
  });

  app.post("/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const user = await deps
      .getUsersRepo()
      .findByEmail(parsed.data.email.toLowerCase());
    // Always pay the bcrypt cost so unknown emails are timing-indistinguishable.
    const ok = await verifyPassword(
      parsed.data.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !ok) {
      logger?.warn("login_failed", {
        ip: c.req.header("x-forwarded-for") ?? "unknown",
      });
      return c.json({ error: "invalid_credentials" }, 401);
    }

    setSessionCookie(c, { uid: user.id, tid: user.tenantId, role: user.role });
    logger?.info("login_ok", { userId: user.id });
    void identifyAnalytics({ distinctId: user.id });
    void captureAnalytics({ distinctId: user.id, event: "user_logged_in" });
    return c.json({ user: toSessionUser(user) });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  const meApp = new Hono<AuthEnv>();
  meApp.use("*", requireUser(deps.sessionSecret));
  meApp.get("/", async (c) => {
    const auth = c.get("auth");
    const usersRepo = deps.getUsersRepo();
    const user = await usersRepo.findById(auth.userId);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const tenant = auth.tenantId
      ? await usersRepo.findTenantById(auth.tenantId)
      : null;
    const response: MeResponse = {
      user: toSessionUser(user),
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            status: tenant.status,
          }
        : null,
      impersonating: auth.impersonating,
    };
    return c.json(response);
  });
  app.route("/me", meApp);

  const runInBackground =
    deps.runInBackground ??
    ((task: Promise<void>): void => {
      void task;
    });

  // Never rejects — store/send failures are logged, not leaked (REQ-004).
  const mintAndSendResetEmail = async (user: UserSelect): Promise<void> => {
    try {
      const rawToken = randomBytes(32).toString("base64url");
      await deps
        .getResetTokensRepo()
        .create(
          user.id,
          sha256Hex(rawToken),
          new Date(Date.now() + RESET_TOKEN_TTL_MS),
        );
      const resetUrl = `${deps.webBaseUrl}/reset-password?token=${rawToken}`;
      await deps.emailProvider.send({
        to: [user.email],
        from: deps.fromEmail,
        subject: "Reset your password",
        html: await renderPasswordReset({ resetUrl }),
        text: `Reset your password (link valid for 1 hour): ${resetUrl}`,
      });
    } catch (err) {
      logger?.warn("forgot_password_failed", { message: String(err) });
    }
  };

  app.post("/forgot-password", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

    const user = await deps
      .getUsersRepo()
      .findByEmail(parsed.data.email.toLowerCase());
    // Token mint + email send happen off the response path so known and
    // unknown emails answer in the same time — identical shape AND timing
    // (REQ-004).
    if (user) runInBackground(mintAndSendResetEmail(user));
    return c.json({ ok: true });
  });

  app.post("/reset-password", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_body", fields: z.flattenError(parsed.error).fieldErrors },
        400,
      );
    }

    const resetRepo = deps.getResetTokensRepo();
    const tokenRow = await resetRepo.findValidByHash(
      sha256Hex(parsed.data.token),
      new Date(),
    );
    if (!tokenRow) return c.json({ error: "invalid_or_expired" }, 400);

    // Hash before claiming so the token is only burned once the new hash is
    // ready; consume() is the atomic single-use gate for concurrent requests.
    const newHash = await hashPassword(parsed.data.password);
    const claimed = await resetRepo.consume(tokenRow.id);
    if (!claimed) return c.json({ error: "invalid_or_expired" }, 400);
    await deps.getUsersRepo().updatePassword(tokenRow.userId, newHash);
    logger?.info("password_reset_ok", { userId: tokenRow.userId });
    return c.json({ ok: true });
  });

  return app;
}
