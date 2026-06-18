import { createHmac, timingSafeEqual } from "node:crypto";

export const EXT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function issueExtensionToken(secret: string, now: number = Date.now()): string {
  const issuedAt = String(now);
  const mac = createHmac("sha256", secret)
    .update(`ext|${issuedAt}`)
    .digest("hex");
  return `${issuedAt}.${mac}`;
}

export function verifyExtensionToken(
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
  if (now - issuedAt > EXT_MAX_AGE_MS) return false;
  const expected = createHmac("sha256", secret)
    .update(`ext|${issuedAtStr}`)
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
