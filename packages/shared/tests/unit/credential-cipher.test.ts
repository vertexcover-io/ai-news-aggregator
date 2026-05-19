import { describe, it, expect } from "vitest";
import { getCredentialCipher } from "@shared/services/credential-cipher.js";

const VALID_SECRET = "x".repeat(64);

function makeEnv(secret: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (secret !== undefined) env.SESSION_SECRET = secret;
  return env;
}

describe("credential-cipher (VS-0)", () => {
  it("round-trips a 151-byte plaintext", () => {
    const cipher = getCredentialCipher(makeEnv(VALID_SECRET));
    const plaintext = "p".repeat(151);
    const blob = cipher.encrypt(plaintext);
    expect(blob.ct).toBeTypeOf("string");
    expect(blob.iv).toBeTypeOf("string");
    expect(blob.tag).toBeTypeOf("string");
    expect(cipher.decrypt(blob)).toBe(plaintext);
  });

  it("throws on decrypt when ct byte 0 is tampered", () => {
    const cipher = getCredentialCipher(makeEnv(VALID_SECRET));
    const blob = cipher.encrypt("hello world");
    const ctBuf = Buffer.from(blob.ct, "base64");
    ctBuf[0] = ctBuf[0] ^ 0xff;
    const tampered = { ...blob, ct: ctBuf.toString("base64") };
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("throws on decrypt when tag byte 0 is tampered", () => {
    const cipher = getCredentialCipher(makeEnv(VALID_SECRET));
    const blob = cipher.encrypt("hello world");
    const tagBuf = Buffer.from(blob.tag, "base64");
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = { ...blob, tag: tagBuf.toString("base64") };
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("throws a clear configuration error when SESSION_SECRET is missing", () => {
    const cipher = getCredentialCipher(makeEnv(undefined));
    expect(() => cipher.encrypt("data")).toThrow(/SESSION_SECRET/);
  });

  it("throws a clear configuration error when SESSION_SECRET is shorter than 32 bytes", () => {
    const cipher = getCredentialCipher(makeEnv("short"));
    expect(() => cipher.encrypt("data")).toThrow(/SESSION_SECRET/);
  });

  it("produces a different IV on consecutive encryptions of the same plaintext", () => {
    const cipher = getCredentialCipher(makeEnv(VALID_SECRET));
    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});
