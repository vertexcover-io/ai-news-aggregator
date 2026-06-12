/**
 * Stateless HMAC session tokens (REQ-005, keeps D-008: HMAC over
 * SESSION_SECRET — the secret also serves as the credential-cipher KEK and
 * must NOT be rotated by this change, D-104).
 *
 * Token format: `<base64url(JSON body)>.<hex hmac>` where the body is
 * `{ userId, tenantId, role, issuedAt }`. Pre-P3 `<timestamp>.<mac>` tokens
 * fail verification (JSON parse) and force a re-login.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@newsletter/shared/types/tenant";

const COOKIE_NAME = "admin_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Impersonation cookie (P6, REQ-101/102): a SEPARATE short-lived token a
 * super_admin carries ALONGSIDE their normal session cookie while operating a
 * tenant's dashboard. The session cookie keeps the original super-admin
 * identity (audit, REQ-103); this one only swaps the acting tenant.
 */
const IMPERSONATION_COOKIE_NAME = "impersonation_session";
const IMPERSONATION_MAX_AGE_MS = 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  /** Null for super_admin sessions (platform-level, no tenant). */
  tenantId: string | null;
  role: UserRole;
}

const ROLES: ReadonlySet<string> = new Set(["super_admin", "tenant_admin"]);

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function issueToken(
  payload: SessionPayload,
  secret: string,
  now: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, issuedAt: now }),
  ).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

/** HMAC check + JSON body parse shared by both token kinds. */
function verifySignedBody(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, givenMac] = parts;
  if (!body || !givenMac) return null;

  const expected = mac(body, secret);
  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = Buffer.from(givenMac, "hex");
    bBuf = Buffer.from(expected, "hex");
  } catch {
    return null;
  }
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return null;
  if (!timingSafeEqual(aBuf, bBuf)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

export function verifyToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  const record = verifySignedBody(token, secret);
  if (record === null) return null;
  const { userId, tenantId, role, issuedAt } = record;
  if (typeof userId !== "string" || userId.length === 0) return null;
  // Also rejects impersonation tokens (they carry actingTenantId, not tenantId).
  if (tenantId !== null && typeof tenantId !== "string") return null;
  if (typeof role !== "string" || !ROLES.has(role)) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;

  if (now - issuedAt > MAX_AGE_MS) return null;

  return { userId, tenantId, role: role as UserRole };
}

/* ── Impersonation token (P6, REQ-101/102/103, EDGE-008) ────────────────── */

export interface ImpersonationPayload {
  /** The SUPER admin's user id — preserved for audit (REQ-103). */
  userId: string;
  role: "super_admin";
  /** Tenant whose dashboard the super admin is operating. */
  actingTenantId: string;
  impersonating: true;
}

export function issueImpersonationToken(
  payload: ImpersonationPayload,
  secret: string,
  now: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, issuedAt: now }),
  ).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifyImpersonationToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): ImpersonationPayload | null {
  const record = verifySignedBody(token, secret);
  if (record === null) return null;
  const { userId, role, actingTenantId, impersonating, issuedAt } = record;
  if (typeof userId !== "string" || userId.length === 0) return null;
  // A regular session token never carries impersonating/actingTenantId —
  // the two token kinds cannot be swapped (EDGE-008).
  if (role !== "super_admin") return null;
  if (typeof actingTenantId !== "string" || actingTenantId.length === 0) return null;
  if (impersonating !== true) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;

  if (now - issuedAt > IMPERSONATION_MAX_AGE_MS) return null;

  return { userId, role, actingTenantId, impersonating };
}

export {
  COOKIE_NAME,
  MAX_AGE_MS,
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_MAX_AGE_MS,
};
