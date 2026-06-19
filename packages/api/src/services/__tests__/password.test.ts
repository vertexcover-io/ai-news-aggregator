import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password.js";

describe("password hashing (scrypt, REQ-121)", () => {
  it("test_REQ_121_password_hash_scrypt_never_plaintext", async () => {
    const hash = await hashPassword("hunter2-very-secret");
    expect(hash).not.toContain("hunter2-very-secret");
    // Format: scrypt$N=...,r=...,p=...$<salt b64>$<hash b64>
    expect(hash).toMatch(/^scrypt\$N=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("test_REQ_121_verify_roundtrip_and_reject_wrong", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("uses a unique random salt per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it.each<{ name: string; stored: string }>([
    { name: "empty string", stored: "" },
    { name: "missing sections", stored: "scrypt$N=16384,r=8,p=1$onlysalt" },
    { name: "unknown algorithm", stored: "argon2$x$y$z" },
    { name: "non-numeric params", stored: "scrypt$N=abc,r=8,p=1$c2FsdA==$aGFzaA==" },
    { name: "invalid base64 hash length", stored: "scrypt$N=16384,r=8,p=1$c2FsdA==$" },
  ])("returns false for malformed stored hash: $name", async ({ stored }) => {
    await expect(verifyPassword("whatever", stored)).resolves.toBe(false);
  });

  it("verifies hashes produced by the P2 migration script format", async () => {
    // Mirror of packages/scripts hashTempPassword (scryptSync N=16384,r=8,p=1, keylen 64)
    const { randomBytes, scryptSync } = await import("node:crypto");
    const salt = randomBytes(16);
    const digest = scryptSync("temp-pass-123", salt, 64, { N: 16384, r: 8, p: 1 });
    const stored = `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${digest.toString("base64")}`;
    await expect(verifyPassword("temp-pass-123", stored)).resolves.toBe(true);
    await expect(verifyPassword("other", stored)).resolves.toBe(false);
  });
});
