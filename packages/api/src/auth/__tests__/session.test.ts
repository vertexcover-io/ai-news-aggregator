import { describe, it, expect } from "vitest";
import {
  issueToken,
  verifyToken,
  MAX_AGE_MS,
  type SessionPayload,
} from "../session.js";

const SECRET = "test-secret-please-rotate";

const PAYLOAD: SessionPayload = {
  userId: "11111111-2222-3333-4444-555555555555",
  tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  role: "tenant_admin",
};

describe("issueToken / verifyToken (REQ-005)", () => {
  it("test_REQ_005_session_cookie_encodes_user_tenant_role", () => {
    const now = 1_700_000_000_000;
    const token = issueToken(PAYLOAD, SECRET, now);
    const decoded = verifyToken(token, SECRET, now);
    expect(decoded).toEqual(PAYLOAD);
  });

  it("encodes a null tenantId for super_admin sessions", () => {
    const payload: SessionPayload = {
      userId: "11111111-2222-3333-4444-555555555555",
      tenantId: null,
      role: "super_admin",
    };
    const token = issueToken(payload, SECRET);
    expect(verifyToken(token, SECRET)).toEqual(payload);
  });

  it("rejects a token with a tampered payload", () => {
    const token = issueToken(PAYLOAD, SECRET);
    const [body, mac] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    forged.role = "super_admin";
    const tamperedBody = Buffer.from(JSON.stringify(forged)).toString(
      "base64url",
    );
    expect(verifyToken(`${tamperedBody}.${mac}`, SECRET)).toBeNull();
  });

  it("rejects a token with a tampered mac", () => {
    const token = issueToken(PAYLOAD, SECRET);
    const [body, mac] = token.split(".");
    const flipped = mac.startsWith("a")
      ? "b" + mac.slice(1)
      : "a" + mac.slice(1);
    expect(verifyToken(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueToken(PAYLOAD, SECRET);
    expect(verifyToken(token, "different-secret")).toBeNull();
  });

  it("rejects a token past the 30-day window", () => {
    const issuedAt = 1_700_000_000_000;
    const token = issueToken(PAYLOAD, SECRET, issuedAt);
    expect(verifyToken(token, SECRET, issuedAt + MAX_AGE_MS + 1)).toBeNull();
  });

  it("accepts a token exactly at the boundary", () => {
    const issuedAt = 1_700_000_000_000;
    const token = issueToken(PAYLOAD, SECRET, issuedAt);
    expect(verifyToken(token, SECRET, issuedAt + MAX_AGE_MS)).toEqual(PAYLOAD);
  });

  it.each<{ name: string; token: string }>([
    { name: "an empty string", token: "" },
    { name: "no dot separator", token: "abcdef1234567890" },
    { name: "an empty mac", token: "eyJ4IjoxfQ." },
    { name: "an empty body", token: ".abcdef" },
    {
      name: "a non-JSON body",
      token: `${Buffer.from("not json").toString("base64url")}.deadbeef`,
    },
  ])("rejects a malformed token: $name", ({ token }) => {
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it("rejects a legacy timestamp-format token", () => {
    // Pre-P3 tokens were `<issuedAt>.<mac>` — they must no longer verify.
    expect(verifyToken("1700000000000.abcdef0123456789", SECRET)).toBeNull();
  });
});
