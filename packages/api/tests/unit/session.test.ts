import { describe, it, expect } from "vitest";
import {
  COOKIE_NAME,
  MAX_AGE_MS,
  issueToken,
  verifyToken,
  verifySessionToken,
  verifyAnyToken,
  verifyPassword,
} from "@api/auth/session.js";

const SECRET = "test-secret-with-at-least-32-bytes-of-length!";

// ── Existing behavior preserved ──────────────────────────────────────────

describe("session - existing behavior preserved", () => {
  it("COOKIE_NAME is still 'admin_session'", () => {
    expect(COOKIE_NAME).toBe("admin_session");
  });

  it("MAX_AGE_MS is 30 days", () => {
    expect(MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("verifyToken accepts a valid legacy token", () => {
    const token = issueToken(SECRET);
    expect(verifyToken(token, SECRET)).toBe(true);
  });

  it("verifyToken rejects a legacy token with wrong secret", () => {
    const token = issueToken(SECRET);
    expect(verifyToken(token, "wrong-secret-like-this-one-is-also-long")).toBe(false);
  });

  it("verifyToken rejects an expired legacy token", () => {
    const past = Date.now() - MAX_AGE_MS - 1000;
    const token = issueToken(SECRET, past);
    expect(verifyToken(token, SECRET)).toBe(false);
  });

  it("verifyToken rejects an empty token", () => {
    expect(verifyToken("", SECRET)).toBe(false);
  });

  it("verifyPassword compares constant-time", () => {
    expect(verifyPassword("abc", "abc")).toBe(true);
    expect(verifyPassword("abc", "abd")).toBe(false);
    expect(verifyPassword("", "")).toBe(true);
    expect(verifyPassword("a", "")).toBe(false);
  });
});

// ── New behavior: payload-bearing session tokens (REQ-005) ───────────────

describe("session - payload tokens (REQ-005)", () => {
  const payload = {
    userId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    role: "tenant_admin" as const,
  };

  it("test_REQ_005_session_cookie_encodes_user_tenant_role", () => {
    const token = issueToken(SECRET, payload);
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    // V2 format: issuedAt.userId.tenantId.role.mac
    expect(token.split(".").length).toBe(5);

    const decoded = verifySessionToken(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe(payload.userId);
    expect(decoded!.tenantId).toBe(payload.tenantId);
    expect(decoded!.role).toBe("tenant_admin");
  });

  it("tampered signature is rejected", () => {
    const token = issueToken(SECRET, payload);
    const parts = token.split(".");
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      parts[3],
      "0".repeat(parts[4].length),
    ].join(".");
    expect(verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("wrong secret is rejected", () => {
    const token = issueToken(SECRET, payload);
    expect(verifySessionToken(token, "wrong-secret-that-is-also-at-least-32")).toBeNull();
  });

  it("expired token is rejected", () => {
    const past = Date.now() - MAX_AGE_MS - 1000;
    const token = issueToken(SECRET, payload, past);
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("verifyAnyToken returns the payload for V2 tokens", () => {
    const token = issueToken(SECRET, payload);
    const result = verifyAnyToken(token, SECRET);
    expect(typeof result).toBe("object");
    if (typeof result === "object") {
      expect(result.userId).toBe(payload.userId);
      expect(result.tenantId).toBe(payload.tenantId);
    }
  });

  it("verifyAnyToken returns true for legacy tokens", () => {
    const token = issueToken(SECRET);
    expect(verifyAnyToken(token, SECRET)).toBe(true);
  });

  it("verifyAnyToken returns false for invalid tokens", () => {
    expect(verifyAnyToken("invalid", SECRET)).toBe(false);
    expect(verifyAnyToken("", SECRET)).toBe(false);
  });
});
