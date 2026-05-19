import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export interface EncryptedBlob {
  ct: string;
  iv: string;
  tag: string;
}

export interface CredentialCipher {
  encrypt(plaintext: string): EncryptedBlob;
  decrypt(blob: EncryptedBlob): string;
}

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const HKDF_SALT = "social-creds-v1";
const HKDF_INFO = "";
const MIN_SECRET_BYTES = 32;

const kekCache = new WeakMap<NodeJS.ProcessEnv, Buffer>();

function deriveKek(env: NodeJS.ProcessEnv): Buffer {
  const cached = kekCache.get(env);
  if (cached) return cached;

  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required for credential encryption but is not set in the environment.",
    );
  }
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes for credential encryption.`,
    );
  }

  const derived = hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, KEY_LENGTH);
  const kek = Buffer.from(derived);
  kekCache.set(env, kek);
  return kek;
}

export function getCredentialCipher(env: NodeJS.ProcessEnv = process.env): CredentialCipher {
  return {
    encrypt(plaintext: string): EncryptedBlob {
      const kek = deriveKek(env);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", kek, iv);
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        ct: ct.toString("base64"),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
      };
    },
    decrypt(blob: EncryptedBlob): string {
      const kek = deriveKek(env);
      const iv = Buffer.from(blob.iv, "base64");
      const tag = Buffer.from(blob.tag, "base64");
      const ct = Buffer.from(blob.ct, "base64");
      const decipher = createDecipheriv("aes-256-gcm", kek, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString("utf8");
    },
  };
}
