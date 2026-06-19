/**
 * Stateless HMAC bearer tokens for the Chrome extension (multi-tenant).
 *
 * Identical body shape to the admin session token — `{ userId, tenantId, role,
 * issuedAt }` — but the HMAC is domain-separated with an `ext|` prefix so an
 * extension token can NEVER be replayed as an `admin_session` cookie and vice
 * versa (blast-radius isolation). The embedded identity is what makes every
 * downstream repo tenant-correct: `requireExtensionAuth` lifts it straight onto
 * `tenantCtx`, exactly like the cookie path does.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "./session.js";

export const EXT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Domain separator — keeps ext tokens disjoint from session/impersonation tokens. */
const EXT_DOMAIN = "ext|";

const ROLES: ReadonlySet<string> = new Set(["super_admin", "tenant_admin"]);

function extMac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${EXT_DOMAIN}${body}`).digest("hex");
}

export function issueExtensionToken(
  payload: SessionPayload,
  secret: string,
  now: number = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, issuedAt: now }),
  ).toString("base64url");
  return `${body}.${extMac(body, secret)}`;
}

export function verifyExtensionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, givenMac] = parts;
  if (!body || !givenMac) return null;

  const expected = extMac(body, secret);
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
  const { userId, tenantId, role, issuedAt } = parsed as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (tenantId !== null && typeof tenantId !== "string") return null;
  if (typeof role !== "string" || !ROLES.has(role)) return null;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;
  if (now - issuedAt > EXT_MAX_AGE_MS) return null;

  return { userId, tenantId, role: role as SessionPayload["role"] };
}
