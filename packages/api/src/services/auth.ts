/**
 * Auth business logic (signup / login / forgot / reset) — routes stay thin
 * (S-api-03). Password hashing via Node scrypt (REQ-121); reset tokens are
 * single-use + short-TTL (REQ-004); signup can never assign super_admin
 * (REQ-006 — the repo seam hardcodes 'tenant_admin').
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./password.js";
import type { UsersRepo } from "../repositories/users.js";
import type { UserRow } from "@newsletter/shared/db";

export class EmailInUseError extends Error {
  constructor() {
    super("email already in use");
    this.name = "EmailInUseError";
  }
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("invalid or expired reset token");
    this.name = "InvalidResetTokenError";
  }
}

/**
 * Unknown keys (e.g. a smuggled `role`) are stripped by zod — the parsed
 * output cannot carry a role (REQ-006).
 */
export const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().trim().max(320),
    password: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.email().trim().max(320),
  password: z.string().min(1).max(200),
});

export const forgotSchema = z.object({
  email: z.email().trim().max(320),
});

export const resetSchema = z
  .object({
    token: z.string().min(1).max(256),
    password: z.string().min(8).max(200),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export interface SignupDeps {
  usersRepo: Pick<UsersRepo, "findByEmail" | "createWithTenant">;
}

export type SignupResult = Awaited<ReturnType<UsersRepo["createWithTenant"]>>;

export async function signup(
  deps: SignupDeps,
  input: SignupInput,
): Promise<SignupResult> {
  const existing = await deps.usersRepo.findByEmail(input.email);
  if (existing !== null) throw new EmailInUseError();

  const passwordHash = await hashPassword(input.password);
  try {
    return await deps.usersRepo.createWithTenant({
      name: input.name,
      email: input.email,
      passwordHash,
      tenantName: input.name,
      // Placeholder slug — the real slug is chosen in the onboarding wizard.
      tenantSlug: `pending-${randomBytes(6).toString("hex")}`,
    });
  } catch (err) {
    // Unique-violation race on users_email_uq (two signups for one email).
    if (isUniqueViolation(err)) throw new EmailInUseError();
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export interface LoginDeps {
  usersRepo: Pick<UsersRepo, "findByEmail">;
}

/** Returns the user on success, null for unknown email OR bad password. */
export async function login(
  deps: LoginDeps,
  input: z.infer<typeof loginSchema>,
): Promise<UserRow | null> {
  const user = await deps.usersRepo.findByEmail(input.email);
  if (user === null) return null;
  const ok = await verifyPassword(input.password, user.passwordHash);
  return ok ? user : null;
}

/**
 * Single-use, short-TTL reset token storage. Production backs this with
 * Redis (SET EX + GETDEL); tests may use an in-memory map.
 */
export interface ResetTokenStore {
  save(tokenHash: string, userId: string, ttlSeconds: number): Promise<void>;
  /** Returns the userId and atomically deletes the entry (single use). */
  consume(tokenHash: string): Promise<string | null>;
}

export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

export interface ForgotDeps {
  usersRepo: Pick<UsersRepo, "findByEmail">;
  resetTokenStore: ResetTokenStore;
  sendResetEmail: (email: string, resetUrl: string) => Promise<void>;
  webBaseUrl: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Always resolves with no signal about whether the email exists (REQ-004 —
 * no enumeration). The route returns the identical body either way.
 */
export async function forgotPassword(
  deps: ForgotDeps,
  email: string,
): Promise<void> {
  const user = await deps.usersRepo.findByEmail(email);
  if (user === null) return;
  const token = randomBytes(32).toString("base64url");
  await deps.resetTokenStore.save(hashToken(token), user.id, RESET_TOKEN_TTL_SECONDS);
  const resetUrl = `${deps.webBaseUrl}/reset-password?token=${token}`;
  await deps.sendResetEmail(user.email, resetUrl);
}

export interface ResetDeps {
  usersRepo: Pick<UsersRepo, "updatePasswordHash">;
  resetTokenStore: ResetTokenStore;
}

export async function resetPassword(
  deps: ResetDeps,
  input: { token: string; password: string },
): Promise<void> {
  const userId = await deps.resetTokenStore.consume(hashToken(input.token));
  if (userId === null) throw new InvalidResetTokenError();
  const passwordHash = await hashPassword(input.password);
  await deps.usersRepo.updatePasswordHash(userId, passwordHash);
}
