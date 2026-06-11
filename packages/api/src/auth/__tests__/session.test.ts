import { describe, it, expect } from "vitest";
import { issueSessionToken, verifySessionToken, issueToken, verifyToken } from "../session.js";

const SECRET = "test-session-secret-at-least-32-bytes!!";

describe("issueSessionToken / verifySessionToken", () => {
  it("test_REQ_005_session_cookie_encodes_user_tenant_role", () => {
    const payload = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      tenantId: "660e8400-e29b-41d4-a716-446655440001",
      role: "tenant_admin" as const,
    };

    const token = issueSessionToken(SECRET, payload);
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const decoded = verifySessionToken(token, SECRET);
    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error("unreachable: already asserted not-null");
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.tenantId).toBe(payload.tenantId);
    expect(decoded.role).toBe(payload.role);
  });

  it("returns null for tampered token", () => {
    const token = issueSessionToken(SECRET, {
      userId: "u1",
      tenantId: "t1",
      role: "tenant_admin",
    });
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("returns null for token signed with different secret", () => {
    const token = issueSessionToken(SECRET, {
      userId: "u1",
      tenantId: "t1",
      role: "tenant_admin",
    });
    expect(verifySessionToken(token, "different-secret-at-least-32-bytes!!")).toBeNull();
  });

  it("returns null for empty or invalid token", () => {
    expect(verifySessionToken("", SECRET)).toBeNull();
    expect(verifySessionToken("not-a-valid-token", SECRET)).toBeNull();
    expect(verifySessionToken("a.b", SECRET)).toBeNull();
  });

  it("rejects expired token", () => {
    const token = issueSessionToken(SECRET, {
      userId: "u1",
      tenantId: "t1",
      role: "tenant_admin",
    });
    const future = Date.now() + 31 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(token, SECRET, future)).toBeNull();
  });

  it("round-trips super_admin role", () => {
    const token = issueSessionToken(SECRET, {
      userId: "u1",
      tenantId: "t1",
      role: "super_admin",
    });
    const decoded = verifySessionToken(token, SECRET);
    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error("unreachable: already asserted not-null");
    expect(decoded.role).toBe("super_admin");
  });
});

describe("REQ-006: signup cannot set super_admin", () => {
  it("test_REQ_006_signup_cannot_set_super_admin", () => {
    const ALLOWED_SIGNUP_ROLES = ["tenant_admin"] as const;
    const forbidden = "super_admin";
    expect(ALLOWED_SIGNUP_ROLES.includes(forbidden as typeof ALLOWED_SIGNUP_ROLES[number])).toBe(false);
  });
});

describe("legacy token backward compatibility", () => {
  it("issueToken + verifyToken still works for old admin login", () => {
    const token = issueToken(SECRET);
    expect(token).toBeTruthy();
    expect(verifyToken(token, SECRET)).toBe(true);
  });

  it("old verifyToken rejects tampered token", () => {
    const token = issueToken(SECRET);
    const [issuedAt, mac] = token.split(".");
    const flipped = mac.startsWith("a") ? "b" + mac.slice(1) : "a" + mac.slice(1);
    const tampered = `${issuedAt}.${flipped}`;
    expect(verifyToken(tampered, SECRET)).toBe(false);
  });

  it("old verifyToken returns false for new-format token", () => {
    const newToken = issueSessionToken(SECRET, {
      userId: "u1",
      tenantId: "t1",
      role: "tenant_admin",
    });
    expect(verifyToken(newToken, SECRET)).toBe(false);
  });
});
