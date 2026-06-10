import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@newsletter/shared/tenant";

const COOKIE_NAME = "admin_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: Role;
  impersonating?: boolean;
}

interface SignedSessionPayload extends SessionPayload {
  iat: number;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signSession(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("hex");
}

export function issueSession(
  payload: SessionPayload,
  secret: string,
  now: number = Date.now(),
): string {
  const signed: SignedSessionPayload = { ...payload, iat: now };
  const encoded = base64url(JSON.stringify(signed));
  const mac = signSession(encoded, secret);
  return `${encoded}.${mac}`;
}

export function verifySession(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, mac] = parts;
  if (!encoded || !mac) return null;
  const expected = signSession(encoded, secret);
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { iat, userId, tenantId, role, impersonating } = parsed;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (now - iat > MAX_AGE_MS) return null;
  if (typeof userId !== "string" || typeof tenantId !== "string") return null;
  if (role !== "super_admin" && role !== "tenant_admin") return null;
  return {
    userId,
    tenantId,
    role,
    ...(impersonating === true ? { impersonating: true } : {}),
  };
}

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

export { COOKIE_NAME, MAX_AGE_MS };
