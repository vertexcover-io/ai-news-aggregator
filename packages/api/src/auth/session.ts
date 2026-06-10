import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "admin_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Payload embedded in a session cookie (D-008 extended). */
export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * Issue a legacy HMAC token (no payload). Used for backwards-compatible
 * admin login. Returns `"<issuedAt>.<hex-mac>"`.
 */
export function issueToken(secret: string, now?: number): string;
/**
 * Issue a V2 session token encoding userId + tenantId + role.
 * Returns `"<issuedAt>.<userId>.<tenantId>.<role>.<hex-mac>"`.
 */
export function issueToken(
  secret: string,
  payload: SessionPayload,
  now?: number,
): string;
export function issueToken(
  secret: string,
  payloadOrNow?: number | SessionPayload,
  maybeNow?: number,
): string {
  const now =
    typeof maybeNow === "number"
      ? maybeNow
      : typeof payloadOrNow === "number"
        ? payloadOrNow
        : Date.now();
  const issuedAt = String(now);

  if (
    payloadOrNow === undefined ||
    typeof payloadOrNow === "number"
  ) {
    const mac = createHmac("sha256", secret)
      .update(`admin|${issuedAt}`)
      .digest("hex");
    return `${issuedAt}.${mac}`;
  }

  const { userId, tenantId, role } = payloadOrNow;
  const payloadSegment = `${userId}|${tenantId}|${role}`;
  const message = `session|${issuedAt}|${payloadSegment}`;
  const mac = createHmac("sha256", secret).update(message).digest("hex");
  return `${issuedAt}.${userId}.${tenantId}.${role}.${mac}`;
}

/**
 * Verify a legacy admin token. Returns `true` if valid.
 */
export function verifyToken(
  token: string,
  secret: string,
  now?: number,
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [issuedAtStr, mac] = parts;
  if (!issuedAtStr || !mac) return false;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (now !== undefined ? now - issuedAt > MAX_AGE_MS : Date.now() - issuedAt > MAX_AGE_MS)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`admin|${issuedAtStr}`)
    .digest("hex");
  return hmacEqual(mac, expected);
}

/**
 * Verify a V2 session token and return the payload, or `null` if invalid.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [issuedAtStr, userId, tenantId, role, mac] = parts;
  if (!issuedAtStr || !userId || !tenantId || !role || !mac) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (now - issuedAt > MAX_AGE_MS) return null;
  const payloadSegment = `${userId}|${tenantId}|${role}`;
  const expected = createHmac("sha256", secret)
    .update(`session|${issuedAtStr}|${payloadSegment}`)
    .digest("hex");
  if (!hmacEqual(mac, expected)) return null;
  return { userId, tenantId, role };
}

/**
 * Verify any session or legacy token.
 * Returns the payload for V2 tokens, `true` for valid legacy tokens, or `false`.
 */
export function verifyAnyToken(
  token: string,
  secret: string,
  now?: number,
): SessionPayload | boolean {
  const parsed = verifySessionToken(token, secret, now);
  if (parsed) return parsed;
  return verifyToken(token, secret, now);
}

/**
 * Timing-safe HMAC comparison.
 */
function hmacEqual(a: string, b: string): boolean {
  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = Buffer.from(a, "hex");
    bBuf = Buffer.from(b, "hex");
  } catch {
    return false;
  }
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyPassword(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(expected, "utf8");
  const len = Math.max(a.length, b.length, 1);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  a.copy(aPad);
  b.copy(bPad);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && a.length === b.length;
}

const IMPERSONATION_COOKIE_NAME = "admin_impersonation";
/** Impersonation tokens are short-lived: 1 hour max. */
const IMPERSONATION_MAX_AGE_MS = 60 * 60 * 1000;

/** Payload embedded in an impersonation cookie (REQ-101). */
export interface ImpersonationPayload {
  userId: string;
  role: "super_admin";
  actingTenantId: string;
  impersonating: true;
}

/**
 * Issue an impersonation token (Phase 6).
 * Format: `"<issuedAt>.<userId>.<actingTenantId>.<mac>"` — distinct prefix `impersonate|`
 * ensures impersonation tokens can never collide with session tokens.
 */
export function issueImpersonationToken(
  secret: string,
  payload: Omit<ImpersonationPayload, "role" | "impersonating">,
  now: number = Date.now(),
): string {
  const issuedAt = String(now);
  const { userId, actingTenantId } = payload;
  const payloadSegment = `${userId}|${actingTenantId}`;
  const message = `impersonate|${issuedAt}|${payloadSegment}`;
  const mac = createHmac("sha256", secret).update(message).digest("hex");
  return `${issuedAt}.${userId}.${actingTenantId}.${mac}`;
}

/**
 * Verify an impersonation token. Returns the payload or null.
 * Impersonation tokens expire after IMPERSONATION_MAX_AGE_MS (1 hour).
 */
export function verifyImpersonationToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): ImpersonationPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [issuedAtStr, userId, actingTenantId, mac] = parts;
  if (!issuedAtStr || !userId || !actingTenantId || !mac) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (now - issuedAt > IMPERSONATION_MAX_AGE_MS) return null;
  const payloadSegment = `${userId}|${actingTenantId}`;
  const expected = createHmac("sha256", secret)
    .update(`impersonate|${issuedAtStr}|${payloadSegment}`)
    .digest("hex");
  if (!hmacEqual(mac, expected)) return null;
  return {
    userId,
    role: "super_admin",
    actingTenantId,
    impersonating: true,
  };
}

export { COOKIE_NAME, MAX_AGE_MS, IMPERSONATION_COOKIE_NAME, IMPERSONATION_MAX_AGE_MS };
