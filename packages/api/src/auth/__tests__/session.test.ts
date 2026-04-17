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

  it("rejects an empty string", () => {
    expect(verifyToken("", SECRET)).toBe(false);
  });

  it("rejects a token with no dot separator", () => {
    expect(verifyToken("abcdef1234567890", SECRET)).toBe(false);
  });

  it("rejects a token with a non-numeric issuedAt", () => {
    const mac = issueToken(SECRET).split(".")[1];
    expect(verifyToken(`notanumber.${mac}`, SECRET)).toBe(false);
  });

  it("rejects a token with empty mac", () => {
    expect(verifyToken("1700000000000.", SECRET)).toBe(false);
  });

  it("rejects a token with empty issuedAt", () => {
    expect(verifyToken(".abcdef", SECRET)).toBe(false);
  });
});

describe("verifyPassword", () => {
  it("returns true on exact match", () => {
    expect(verifyPassword("hunter2", "hunter2")).toBe(true);
  });

  it("returns false on mismatch of same length", () => {
    expect(verifyPassword("hunter2", "hunter3")).toBe(false);
  });

  it("returns false when submitted is shorter", () => {
    expect(verifyPassword("short", "longer-password")).toBe(false);
  });

  it("returns false when submitted is longer", () => {
    expect(verifyPassword("longer-password", "short")).toBe(false);
  });

  it("returns false for empty submitted vs non-empty expected", () => {
    expect(verifyPassword("", "hunter2")).toBe(false);
  });

  it("returns false for non-empty submitted vs empty expected", () => {
    expect(verifyPassword("hunter2", "")).toBe(false);
  });

  it("returns true when both are empty", () => {
    expect(verifyPassword("", "")).toBe(true);
  });
});
