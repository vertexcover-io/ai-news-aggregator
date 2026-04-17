import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "admin_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
