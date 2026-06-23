/**
 * Extension bearer token — identity round-trip, expiry, and the security-
 * critical namespace isolation from the admin session cookie token. The two
 * token kinds share a body shape but use a different HMAC domain, so neither
 * can be replayed as the other (blast-radius containment).
 */
import { describe, it, expect } from "vitest";
import {
  issueExtensionToken,
  verifyExtensionToken,
  EXT_MAX_AGE_MS,
} from "../extension-token.js";
import { issueToken, verifyToken } from "../session.js";

const SECRET = "ext-token-test-secret";
const PAYLOAD = {
  userId: "u-1",
  tenantId: "t-1",
  role: "tenant_admin" as const,
};

describe("extension token", () => {
  it("round-trips the embedded identity", () => {
    const tok = issueExtensionToken(PAYLOAD, SECRET);
    expect(verifyExtensionToken(tok, SECRET)).toEqual(PAYLOAD);
  });

  it("rejects garbage, wrong secret, and tampered tokens", () => {
    expect(verifyExtensionToken("garbage", SECRET)).toBeNull();
    expect(verifyExtensionToken("", SECRET)).toBeNull();
    const tok = issueExtensionToken(PAYLOAD, SECRET);
    expect(verifyExtensionToken(tok, "wrong-secret")).toBeNull();
    // Flip the final MAC hex digit — a real signature mismatch.
    const last = tok.slice(-1);
    const flipped = `${tok.slice(0, -1)}${last === "0" ? "1" : "0"}`;
    expect(verifyExtensionToken(flipped, SECRET)).toBeNull();
    // Tamper the body so the MAC no longer matches it.
    const [body, m] = tok.split(".");
    expect(verifyExtensionToken(`${body}AA.${m}`, SECRET)).toBeNull();
  });

  it("rejects an expired token at the 30-day boundary", () => {
    const now = 1_700_000_000_000;
    const tok = issueExtensionToken(PAYLOAD, SECRET, now);
    expect(verifyExtensionToken(tok, SECRET, now + EXT_MAX_AGE_MS - 1)).toEqual(
      PAYLOAD,
    );
    expect(
      verifyExtensionToken(tok, SECRET, now + EXT_MAX_AGE_MS + 1),
    ).toBeNull();
  });

  it("is namespace-isolated from the session cookie token (both directions)", () => {
    // A session cookie token must NOT verify as an extension token...
    const session = issueToken(PAYLOAD, SECRET);
    expect(verifyExtensionToken(session, SECRET)).toBeNull();
    // ...and an extension token must NOT verify as a session cookie token.
    const ext = issueExtensionToken(PAYLOAD, SECRET);
    expect(verifyToken(ext, SECRET)).toBeNull();
  });
});
