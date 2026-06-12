import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { UserRole } from "@newsletter/shared";

const COOKIE_NAME = "session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionClaims {
  uid: string;
  tid: string | null;
  role: UserRole;
  /** Impersonated tenant id, present while a super_admin impersonates. */
  imp?: string;
  iat: number;
}

const claimsSchema = z.object({
  uid: z.string().min(1),
  tid: z.string().min(1).nullable(),
  role: z.enum(["tenant_admin", "super_admin"]),
  imp: z.string().min(1).optional(),
  iat: z.number().int(),
});

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function serialize(claims: SessionClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function issueSession(
  claims: Omit<SessionClaims, "iat">,
  secret: string,
  now: number = Date.now(),
): string {
  return serialize({ ...claims, iat: now }, secret);
}

/** Reissues the token with `imp` set, preserving uid/tid/role and the
 * original iat so impersonation never extends the session's 30d window. */
export function withImpersonation(
  claims: SessionClaims,
  tenantId: string,
  secret: string,
): string {
  return serialize({ ...claims, imp: tenantId }, secret);
}

/** Reissues the token with `imp` stripped; all other claims (incl. iat)
 * are preserved. */
export function withoutImpersonation(
  claims: SessionClaims,
  secret: string,
): string {
  const { imp: _imp, ...rest } = claims;
  return serialize(rest, secret);
}

export function verifySession(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  if (!payload || !mac) return null;

  const expected = sign(payload, secret);
  let macBuf: Buffer;
  try {
    macBuf = Buffer.from(mac, "hex");
  } catch {
    return null;
  }
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length === 0 || macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (now - parsed.data.iat > MAX_AGE_MS) return null;
  return parsed.data;
}

export { COOKIE_NAME, MAX_AGE_MS };
