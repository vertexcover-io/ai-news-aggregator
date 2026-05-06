import { describe, it, expect } from "vitest";
import { parseSnsMessageUnchecked } from "@api/lib/sns-verifier.js";

function makeSnsJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: "msg-123",
    TopicArn: "arn:aws:sns:us-east-1:123456789:MyTopic",
    Message: '{"notificationType":"Delivery"}',
    Timestamp: "2024-01-01T00:00:00.000Z",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    Signature: "base64sighere==",
    SignatureVersion: "1",
    ...overrides,
  });
}

describe("parseSnsMessageUnchecked", () => {
  it("parses valid SNS JSON and returns typed object", () => {
    const msg = parseSnsMessageUnchecked(makeSnsJson());

    expect(msg.Type).toBe("Notification");
    expect(msg.MessageId).toBe("msg-123");
    expect(msg.TopicArn).toBe("arn:aws:sns:us-east-1:123456789:MyTopic");
    expect(msg.SigningCertURL).toBe("https://sns.us-east-1.amazonaws.com/cert.pem");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSnsMessageUnchecked("not-json")).toThrow("SNS message is not valid JSON");
  });

  it("throws if Type field missing", () => {
    const raw = JSON.stringify({ MessageId: "x", Message: "y" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: Type");
  });

  it("parses SubscriptionConfirmation type", () => {
    const msg = parseSnsMessageUnchecked(
      makeSnsJson({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm?token=abc",
        Token: "long-token-here",
      }),
    );
    expect(msg.Type).toBe("SubscriptionConfirmation");
    expect(msg.SubscribeURL).toBe("https://sns.us-east-1.amazonaws.com/confirm?token=abc");
  });
});
