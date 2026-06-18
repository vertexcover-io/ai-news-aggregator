import { describe, expect, it } from "vitest";
import { getCredentialCipher } from "@shared/services/credential-cipher.js";
import type { AppCredentialKey, ApifyEncryptedFields } from "@shared/db/schema.js";

const VALID_SECRET = "x".repeat(64);

function makeEnv(secret: string): NodeJS.ProcessEnv {
  return { SESSION_SECRET: secret };
}

describe("REQ-014: apify_api_token app-credential key and encrypted fields", () => {
  it("test_REQ_014_apify_credential_key_and_blob: apify_api_token is a valid AppCredentialKey and round-trips through cipher", () => {
    // Type-level assertion: "apify_api_token" must be assignable to AppCredentialKey
    const key: AppCredentialKey = "apify_api_token";
    expect(key).toBe("apify_api_token");

    // Cipher round-trip: encrypt then decrypt an ApifyEncryptedFields value
    const cipher = getCredentialCipher(makeEnv(VALID_SECRET));
    const plaintext = "apify-test-token-abc123";
    const blob = cipher.encrypt(plaintext);

    // Construct an ApifyEncryptedFields value using the encrypted blob
    const fields: ApifyEncryptedFields = { apiToken: blob };
    expect(fields.apiToken.ct).toBeTypeOf("string");
    expect(fields.apiToken.iv).toBeTypeOf("string");
    expect(fields.apiToken.tag).toBeTypeOf("string");

    // Decrypt and verify round-trip
    const decrypted = cipher.decrypt(fields.apiToken);
    expect(decrypted).toBe(plaintext);
  });
});
