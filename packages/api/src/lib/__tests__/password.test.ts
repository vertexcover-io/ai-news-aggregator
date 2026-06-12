import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password.js";

describe("password hashing (REQ-121 / NF2)", () => {
  it("hashes with bcrypt cost 12", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });
});
