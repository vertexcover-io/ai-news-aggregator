import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { issueSession, COOKIE_NAME } from "@api/auth/session.js";
import type { SessionClaims } from "@api/auth/session.js";

/** Mint a Cookie header value for a fake authenticated user. The session is
 * stateless (HMAC-signed), so no DB row is required for gate-only tests.
 * Defaults to tenant 0 so admin routes scope to the e2e suites' seeded rows;
 * pass `tid` to act as a different tenant. */
export function makeSessionCookie(
  secret: string,
  overrides?: Partial<Omit<SessionClaims, "iat">>,
): string {
  const token = issueSession(
    {
      uid: "00000000-0000-0000-0000-00000000aaaa",
      tid: TENANT_ZERO_ID,
      role: "tenant_admin",
      ...overrides,
    },
    secret,
  );
  return `${COOKIE_NAME}=${token}`;
}
