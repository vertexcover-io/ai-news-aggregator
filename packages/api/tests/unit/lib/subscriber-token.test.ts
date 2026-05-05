import { describe, it, expect } from "vitest";
import {
  issueSubscriberToken,
  verifySubscriberToken,
} from "@api/lib/subscriber-token.js";

const SECRET = "test-secret-for-subscriber-tokens";
const SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000001";

describe("issueSubscriberToken + verifySubscriberToken", () => {
  it("round-trips correctly for confirm type", () => {
    const token = issueSubscriberToken(SUBSCRIBER_ID, "confirm", SECRET);
    const result = verifySubscriberToken(token, "confirm", SECRET);
    expect(result).toEqual({
      valid: true,
      subscriberId: SUBSCRIBER_ID,
      type: "confirm",
    });
  });

  it("round-trips correctly for unsub type", () => {
    const token = issueSubscriberToken(SUBSCRIBER_ID, "unsub", SECRET);
    const result = verifySubscriberToken(token, "unsub", SECRET);
    expect(result).toEqual({
      valid: true,
      subscriberId: SUBSCRIBER_ID,
      type: "unsub",
    });
  });

  it("returns expired when expiresAt is in the past", () => {
    const pastDate = new Date(Date.now() - 1000);
    const token = issueSubscriberToken(SUBSCRIBER_ID, "confirm", SECRET, pastDate);
    const result = verifySubscriberToken(token, "confirm", SECRET);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("returns invalid when MAC is tampered", () => {
    const token: string = issueSubscriberToken(SUBSCRIBER_ID, "confirm", SECRET);
    const parts = token.split(".");
    const tampered = `${parts[0]}.aaaa1234aaaa1234aaaa1234aaaa1234aaaa1234aaaa1234aaaa1234aaaa1234`;
    const result = verifySubscriberToken(tampered, "confirm", SECRET);
    expect(result).toEqual({ valid: false, reason: "invalid" });
  });

  it("returns wrong-type when confirm token is verified as unsub", () => {
    const token = issueSubscriberToken(SUBSCRIBER_ID, "confirm", SECRET);
    const result = verifySubscriberToken(token, "unsub", SECRET);
    expect(result).toEqual({ valid: false, reason: "wrong-type" });
  });

  it("returns invalid for tokens with no dots", () => {
    const result = verifySubscriberToken("nodotsinhere", "confirm", SECRET);
    expect(result).toEqual({ valid: false, reason: "invalid" });
  });

  it("returns invalid for completely garbage tokens", () => {
    const result = verifySubscriberToken("!!!.garbage", "confirm", SECRET);
    expect(result).toEqual({ valid: false, reason: "invalid" });
  });

  it("unsub tokens with far-future expiry do not expire", () => {
    const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
    const token = issueSubscriberToken(SUBSCRIBER_ID, "unsub", SECRET, farFuture);
    const result = verifySubscriberToken(token, "unsub", SECRET);
    expect(result).toEqual({
      valid: true,
      subscriberId: SUBSCRIBER_ID,
      type: "unsub",
    });
  });
});
