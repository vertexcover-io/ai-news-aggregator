import { describe, it, expect } from "vitest";
import {
  issueSession,
  verifySession,
  withImpersonation,
  withoutImpersonation,
  COOKIE_NAME,
  MAX_AGE_MS,
} from "../session.js";

const SECRET = "test-secret-please-rotate";
const NOW = 1_700_000_000_000;

const tenantAdmin = {
  uid: "11111111-1111-1111-1111-111111111111",
  tid: "22222222-2222-2222-2222-222222222222",
  role: "tenant_admin" as const,
};

describe("issueSession / verifySession", () => {
  it("uses the new cookie name", () => {
    expect(COOKIE_NAME).toBe("session");
  });

  it("test_REQ_005_session_cookie_encodes_user_tenant_role", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    const claims = verifySession(token, SECRET, NOW);
    expect(claims).toEqual({ ...tenantAdmin, iat: NOW });
  });

  it("round-trips a super_admin with null tenant id", () => {
    const token = issueSession(
      { uid: tenantAdmin.uid, tid: null, role: "super_admin" },
      SECRET,
      NOW,
    );
    const claims = verifySession(token, SECRET, NOW);
    expect(claims).toEqual({
      uid: tenantAdmin.uid,
      tid: null,
      role: "super_admin",
      iat: NOW,
    });
  });

  it("round-trips an impersonation claim", () => {
    const imp = "33333333-3333-3333-3333-333333333333";
    const token = issueSession(
      { uid: tenantAdmin.uid, tid: null, role: "super_admin", imp },
      SECRET,
      NOW,
    );
    const claims = verifySession(token, SECRET, NOW);
    expect(claims?.imp).toBe(imp);
  });

  it("rejects a tampered payload", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    const [payload, mac] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    forged.role = "super_admin";
    const forgedPayload = Buffer.from(JSON.stringify(forged)).toString(
      "base64url",
    );
    expect(verifySession(`${forgedPayload}.${mac}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered mac", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    const [payload, mac] = token.split(".");
    const flipped = mac.startsWith("a")
      ? "b" + mac.slice(1)
      : "a" + mac.slice(1);
    expect(verifySession(`${payload}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    expect(verifySession(token, "different-secret", NOW)).toBeNull();
  });

  it("rejects a token past the 30-day window", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + MAX_AGE_MS + 1)).toBeNull();
  });

  it("accepts a token exactly at the boundary", () => {
    const token = issueSession(tenantAdmin, SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + MAX_AGE_MS)).not.toBeNull();
  });

  it("rejects the legacy admin token format", () => {
    expect(verifySession(`${NOW}.deadbeef`, SECRET, NOW)).toBeNull();
  });

  it.each<{ name: string; token: string }>([
    { name: "an empty string", token: "" },
    { name: "no dot separator", token: "abcdef1234567890" },
    { name: "non-base64url payload", token: "!!!.abcdef" },
    { name: "non-JSON payload", token: `${Buffer.from("nope").toString("base64url")}.abcdef` },
    {
      name: "JSON payload missing claims",
      token: `${Buffer.from(JSON.stringify({ uid: "x" })).toString("base64url")}.abcdef`,
    },
    { name: "an empty mac", token: `${Buffer.from("{}").toString("base64url")}.` },
    { name: "an empty payload", token: ".abcdef" },
  ])("rejects a malformed token: $name", ({ token }) => {
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });
});

describe("withImpersonation / withoutImpersonation (REQ-101/102)", () => {
  const superAdmin = {
    uid: "44444444-4444-4444-4444-444444444444",
    tid: null,
    role: "super_admin" as const,
    iat: NOW,
  };
  const IMP = "33333333-3333-3333-3333-333333333333";

  it("withImpersonation sets imp and preserves uid/tid/role/iat", () => {
    const token = withImpersonation(superAdmin, IMP, SECRET);
    const claims = verifySession(token, SECRET, NOW);
    expect(claims).toEqual({ ...superAdmin, imp: IMP });
  });

  it("withImpersonation does NOT extend the 30-day window (iat preserved)", () => {
    const token = withImpersonation(superAdmin, IMP, SECRET);
    expect(verifySession(token, SECRET, NOW + MAX_AGE_MS)).not.toBeNull();
    expect(verifySession(token, SECRET, NOW + MAX_AGE_MS + 1)).toBeNull();
  });

  it("withImpersonation replaces an existing imp claim", () => {
    const other = "55555555-5555-5555-5555-555555555555";
    const token = withImpersonation({ ...superAdmin, imp: other }, IMP, SECRET);
    expect(verifySession(token, SECRET, NOW)?.imp).toBe(IMP);
  });

  it("withoutImpersonation strips imp and preserves everything else", () => {
    const claims = verifySession(
      withoutImpersonation({ ...superAdmin, imp: IMP }, SECRET),
      SECRET,
      NOW,
    );
    expect(claims).toEqual(superAdmin);
    expect(claims?.imp).toBeUndefined();
  });

  it("reissued tokens carry a valid HMAC (round-trip through verifySession)", () => {
    const token = withImpersonation(superAdmin, IMP, SECRET);
    expect(verifySession(token, "wrong-secret", NOW)).toBeNull();
    expect(verifySession(token, SECRET, NOW)).not.toBeNull();
  });
});
