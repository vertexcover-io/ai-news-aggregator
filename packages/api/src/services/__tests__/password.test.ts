import { describe, it, expect } from "vitest";
import { hashPassword, verifyPasswordHash } from "../password.js";

describe("hashPassword / verifyPasswordHash", () => {
  it("produces an argon2id hash that verifies against the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPasswordHash(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret");
    expect(await verifyPasswordHash(hash, "wrong")).toBe(false);
  });

  it("produces distinct hashes for the same password (salted)", async () => {
    const a = await hashPassword("samePassword");
    const b = await hashPassword("samePassword");
    expect(a).not.toBe(b);
    expect(await verifyPasswordHash(a, "samePassword")).toBe(true);
    expect(await verifyPasswordHash(b, "samePassword")).toBe(true);
  });
});
