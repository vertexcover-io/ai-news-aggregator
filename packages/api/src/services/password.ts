/**
 * Password hashing with Node's built-in scrypt (REQ-121).
 *
 * No external dependency (argon2/bcrypt are intentionally NOT used — see
 * library-probe: "no new deps"). scrypt is memory-hard and OWASP-recommended.
 *
 * Stored format (matches the P2 migration script `hashTempPassword`):
 *   scrypt$N=<cost>,r=<blockSize>,p=<parallelism>$<salt base64>$<hash base64>
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const FORMAT_RE = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, params, (err, derived) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES, SCRYPT_PARAMS);
  const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
  return `scrypt$${params}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const match = FORMAT_RE.exec(stored);
  if (!match) return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = match;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  } catch {
    // Invalid/oversized params — treat as non-matching, never throw to callers.
    return false;
  }
  return timingSafeEqual(derived, expected);
}
