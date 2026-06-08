import { createHmac, timingSafeEqual } from "node:crypto";

export type SubscriberTokenType = "confirm" | "unsub" | "feedback";

export function issueSubscriberToken(
  subscriberId: string,
  type: SubscriberTokenType,
  secret: string,
  expiresAt?: Date,
): string {
  const expires = (expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)).getTime();
  const payload = `${subscriberId}:${type}:${expires}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + mac;
}

export type VerifyResult =
  | { valid: true; subscriberId: string; type: SubscriberTokenType }
  | { valid: false; reason: "invalid" | "expired" | "wrong-type" };

export function verifySubscriberToken(
  token: string,
  expectedType: SubscriberTokenType,
  secret: string,
): VerifyResult {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return { valid: false, reason: "invalid" };

  const encodedPayload = token.slice(0, dotIndex);
  const mac = token.slice(dotIndex + 1);
  if (!encodedPayload || !mac) return { valid: false, reason: "invalid" };

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString();
  } catch {
    return { valid: false, reason: "invalid" };
  }

  const expectedMac = createHmac("sha256", secret).update(payload).digest("hex");

  let macBuf: Buffer;
  let expectedMacBuf: Buffer;
  try {
    macBuf = Buffer.from(mac, "hex");
    expectedMacBuf = Buffer.from(expectedMac, "hex");
  } catch {
    return { valid: false, reason: "invalid" };
  }

  if (macBuf.length === 0 || macBuf.length !== expectedMacBuf.length) {
    return { valid: false, reason: "invalid" };
  }

  if (!timingSafeEqual(macBuf, expectedMacBuf)) {
    return { valid: false, reason: "invalid" };
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return { valid: false, reason: "invalid" };

  const [subscriberId, type, expiresStr] = parts;
  if (!subscriberId || !type || !expiresStr) return { valid: false, reason: "invalid" };

  if (type !== "confirm" && type !== "unsub" && type !== "feedback") {
    return { valid: false, reason: "invalid" };
  }

  if (type !== expectedType) return { valid: false, reason: "wrong-type" };

  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt)) return { valid: false, reason: "invalid" };

  if (Date.now() > expiresAt) return { valid: false, reason: "expired" };

  return { valid: true, subscriberId, type };
}
