import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  issueExtensionToken,
  verifyExtensionToken,
  EXT_MAX_AGE_MS,
} from "@api/auth/extension-token.js";

const SECRET = "test-secret-32-bytes-xxxxxxxxxxx";

describe("issueExtensionToken / verifyExtensionToken", () => {
  it("test_REQ_001_login_returns_token: issued token verifies with same secret", () => {
    const token = issueExtensionToken(SECRET);
    expect(verifyExtensionToken(token, SECRET)).toBe(true);
  });

  it("test_REQ_004_middleware_rejects_invalid_bearer: rejects token signed with different secret (EDGE-001)", () => {
    const token = issueExtensionToken(SECRET);
    expect(verifyExtensionToken(token, "wrong-secret-32-bytes-xxxxxxxxx")).toBe(false);
  });

  it("test_REQ_004_middleware_rejects_invalid_bearer: rejects expired token (EDGE-002)", () => {
    const now = Date.now();
    const token = issueExtensionToken(SECRET, now - EXT_MAX_AGE_MS - 1);
    expect(verifyExtensionToken(token, SECRET, now)).toBe(false);
  });

  it("rejects an admin token that uses 'admin|' prefix — namespace isolation", () => {
    // Craft a token with admin| prefix using the same secret
    const issuedAt = String(Date.now());
    const mac = createHmac("sha256", SECRET).update(`admin|${issuedAt}`).digest("hex");
    const adminToken = `${issuedAt}.${mac}`;
    // Must not verify as an extension token
    expect(verifyExtensionToken(adminToken, SECRET)).toBe(false);
  });

  it("rejects empty token", () => {
    expect(verifyExtensionToken("", SECRET)).toBe(false);
  });

  it("rejects malformed token (no dot separator)", () => {
    expect(verifyExtensionToken("notadottedtoken", SECRET)).toBe(false);
  });

  it("rejects token with non-numeric issuedAt", () => {
    expect(verifyExtensionToken("notanumber.deadbeef", SECRET)).toBe(false);
  });
});
