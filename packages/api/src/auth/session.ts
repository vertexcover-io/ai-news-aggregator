import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "admin_session";
export const SESSION_COOKIE_NAME = "session";
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ── Legacy (admin|ts) token — kept for backward compat until P6 ──────────

export function issueToken(secret: string, now: number = Date.now()): string {
  const issuedAt = String(now);
  const mac = createHmac("sha256", secret)
    .update(`admin|${issuedAt}`)
    .digest("hex");
  return `${issuedAt}.${mac}`;
}

export function verifyToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [issuedAtStr, mac] = parts;
  if (!issuedAtStr || !mac) return false;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;
  if (now - issuedAt > MAX_AGE_MS) return false;
  const expected = createHmac("sha256", secret)
    .update(`admin|${issuedAtStr}`)
    .digest("hex");
  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = Buffer.from(mac, "hex");
    bBuf = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// ── New stateless session token (userId + tenantId + role) ─────────────

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: "tenant_admin" | "super_admin";
}

/**
 * Issue a stateless session token encoding userId, tenantId, and role.
 * Format: base64url(payload).hmac
 */
export function issueSessionToken(
  secret: string,
  payload: SessionPayload,
): string {
  const issuedAt = String(Date.now());
  const body = JSON.stringify({
    u: payload.userId,
    t: payload.tenantId,
    r: payload.role,
    i: issuedAt,
  });
  const encoded = Buffer.from(body, "utf8").toString("base64url");
  const mac = createHmac("sha256", secret)
    .update(`session|${encoded}`)
    .digest("hex");
  return `${encoded}.${mac}`;
}

/**
 * Verify a session token and return its payload, or null if invalid/expired.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;
  const encoded = token.slice(0, lastDot);
  const mac = token.slice(lastDot + 1);
  if (!encoded || !mac) return null;

  const expected = createHmac("sha256", secret)
    .update(`session|${encoded}`)
    .digest("hex");

  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = Buffer.from(mac, "hex");
    bBuf = Buffer.from(expected, "hex");
  } catch {
    return null;
  }
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) return null;
  if (!timingSafeEqual(aBuf, bBuf)) return null;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  const userId = typeof body.u === "string" ? body.u : null;
  const tenantId = typeof body.t === "string" ? body.t : null;
  const role =
    body.r === "tenant_admin" || body.r === "super_admin" ? body.r : null;
  const issuedAt =
    typeof body.i === "string" ? Number(body.i) : NaN;

  if (!userId || !tenantId || !role || !Number.isFinite(issuedAt)) {
    return null;
  }

  if (now - issuedAt > MAX_AGE_MS) return null;

  return { userId, tenantId, role };
}

// Legacy password verify (deprecated — use password service instead)
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

export { COOKIE_NAME };
