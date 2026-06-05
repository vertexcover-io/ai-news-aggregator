import { describe, it, expect } from "vitest";
import {
  issueToken,
  verifyToken,
  verifyPassword,
  MAX_AGE_MS,
} from "../session.js";

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
