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

export function verifyToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
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
  const record = parsed as Record<string, unknown>;
  const { userId, tenantId, role, issuedAt } = record;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (tenantId !== null && typeof tenantId !== "string") return null;
  if (typeof role !== "string" || !ROLES.has(role)) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;

  if (now - issuedAt > MAX_AGE_MS) return null;

  return { userId, tenantId, role: role as UserRole };
}

export { COOKIE_NAME, MAX_AGE_MS };
