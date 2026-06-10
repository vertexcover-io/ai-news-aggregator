import { describe, it, expect } from "vitest";
import {
  issueToken,
  verifyToken,
  verifyPassword,
  verifySessionToken,
  verifyAnyToken,
  issueImpersonationToken,
  verifyImpersonationToken,
  MAX_AGE_MS,
  IMPERSONATION_MAX_AGE_MS,
} from "../session.js";
import type { SessionPayload, ImpersonationPayload } from "../session.js";

const SECRET = "test-secret-please-rotate";

describe("issueToken / verifyToken", () => {
  it("round-trips a freshly issued token", () => {
    const now = 1_700_000_000_000;
    const token = issueToken(SECRET, now);
    expect(verifyToken(token, SECRET, now)).toBe(true);
  });

  it("rejects a token with tampered mac", () => {
    const token = issueToken(SECRET);
    const [issuedAt, mac] = token.split(".");
    const flipped = mac.startsWith("a") ? "b" + mac.slice(1) : "a" + mac.slice(1);
    const tampered = `${issuedAt}.${flipped}`;
    expect(verifyToken(tampered, SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueToken(SECRET);
    expect(verifyToken(token, "different-secret")).toBe(false);
  });

  it("rejects a token past the 30-day window", () => {
    const issuedAt = 1_700_000_000_000;
    const token = issueToken(SECRET, issuedAt);
    const later = issuedAt + MAX_AGE_MS + 1;
    expect(verifyToken(token, SECRET, later)).toBe(false);
  });

  it("accepts a token exactly at the boundary", () => {
    const issuedAt = 1_700_000_000_000;
    const token = issueToken(SECRET, issuedAt);
    const boundary = issuedAt + MAX_AGE_MS;
    expect(verifyToken(token, SECRET, boundary)).toBe(true);
  });

  it.each<{ name: string; token: () => string }>([
    { name: "an empty string", token: () => "" },
    { name: "no dot separator", token: () => "abcdef1234567890" },
    {
      name: "a non-numeric issuedAt",
      token: () => `notanumber.${issueToken(SECRET).split(".")[1]}`,
    },
    { name: "an empty mac", token: () => "1700000000000." },
    { name: "an empty issuedAt", token: () => ".abcdef" },
  ])("rejects a malformed token: $name", ({ token }) => {
    expect(verifyToken(token(), SECRET)).toBe(false);
  });
});

describe("verifyPassword", () => {
  it("returns true on exact match", () => {
    expect(verifyPassword("hunter2", "hunter2")).toBe(true);
  });

  it("returns true when both are empty", () => {
    expect(verifyPassword("", "")).toBe(true);
  });

  it.each<{ name: string; submitted: string; expected: string }>([
    { name: "mismatch of same length", submitted: "hunter2", expected: "hunter3" },
    { name: "submitted shorter", submitted: "short", expected: "longer-password" },
    { name: "submitted longer", submitted: "longer-password", expected: "short" },
    { name: "empty submitted vs non-empty expected", submitted: "", expected: "hunter2" },
    { name: "non-empty submitted vs empty expected", submitted: "hunter2", expected: "" },
  ])("returns false for $name", ({ submitted, expected }) => {
    expect(verifyPassword(submitted, expected)).toBe(false);
  });
});

describe("V2 session tokens", () => {
  const payload: SessionPayload = {
    userId: "user-1",
    tenantId: "tenant-1",
    role: "tenant_admin",
  };

  it("test_REQ_101_v2_token_round_trips_payload", () => {
    const now = 1_700_000_000_000;
    const token = issueToken(SECRET, payload, now);
    const parsed = verifySessionToken(token, SECRET, now);
    expect(parsed).toEqual(payload);
  });

  it("rejects a V2 token with tampered mac", () => {
    const token = issueToken(SECRET, payload);
    const parts = token.split(".");
    parts[4] = parts[4].startsWith("a") ? "b" + parts[4].slice(1) : "a" + parts[4].slice(1);
    const tampered = parts.join(".");
    expect(verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a V2 token past the 30-day window", () => {
    const issuedAt = 1_700_000_000_000;
    const token = issueToken(SECRET, payload, issuedAt);
    const later = issuedAt + MAX_AGE_MS + 1;
    expect(verifySessionToken(token, SECRET, later)).toBeNull();
  });

  it("verifyAnyToken returns payload for V2 tokens", () => {
    const token = issueToken(SECRET, payload);
    const result = verifyAnyToken(token, SECRET);
    expect(result).toEqual(payload);
  });

  it("verifyAnyToken returns true for legacy tokens", () => {
    const token = issueToken(SECRET);
    expect(verifyAnyToken(token, SECRET)).toBe(true);
  });

  it("verifySessionToken returns null for a legacy token", () => {
    const token = issueToken(SECRET);
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });
});

// ── Phase 6: Impersonation tokens ────────────────────────────────────────────

describe("impersonation tokens — REQ-101, REQ-102", () => {
  const superUserId = "super-user-1";
  const targetTenantId = "tenant-target-42";

  it("test_REQ_101_impersonation_token_round_trips_payload", () => {
    const now = 1_700_000_000_000;
    const token = issueImpersonationToken(
      SECRET,
      { userId: superUserId, actingTenantId: targetTenantId },
      now,
    );
    const parsed = verifyImpersonationToken(token, SECRET, now);
    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe(superUserId);
    expect(parsed!.role).toBe("super_admin");
    expect(parsed!.actingTenantId).toBe(targetTenantId);
    expect(parsed!.impersonating).toBe(true);
  });

  it("test_REQ_102_impersonation_token_expires_quickly", () => {
    const now = 1_700_000_000_000;
    const token = issueImpersonationToken(
      SECRET,
      { userId: superUserId, actingTenantId: targetTenantId },
      now,
    );
    // Valid at boundary
    const atBoundary = now + IMPERSONATION_MAX_AGE_MS;
    expect(verifyImpersonationToken(token, SECRET, atBoundary)).not.toBeNull();
    // Expired one ms past boundary
    const pastBoundary = now + IMPERSONATION_MAX_AGE_MS + 1;
    expect(verifyImpersonationToken(token, SECRET, pastBoundary)).toBeNull();
  });

  it("impersonation token cannot be verified as a regular session token", () => {
    const token = issueImpersonationToken(SECRET, {
      userId: superUserId,
      actingTenantId: targetTenantId,
    });
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("regular session token cannot be verified as an impersonation token", () => {
    const sessionToken = issueToken(SECRET, {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "super_admin",
    });
    expect(verifyImpersonationToken(sessionToken, SECRET)).toBeNull();
  });
});
