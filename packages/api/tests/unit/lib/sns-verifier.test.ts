import { createSign, generateKeyPairSync } from "crypto";
import { describe, it, expect, vi } from "vitest";
import { parseSnsMessageUnchecked, verifySnsMessage } from "@api/lib/sns-verifier.js";
import type { SnsMessage } from "@api/lib/sns-verifier.js";

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

// ---------------------------------------------------------------------------
// Test helpers for verifySnsMessage
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

function signNotification(msg: SnsMessage): string {
  const signingString =
    `Message\n${msg.Message}\n` +
    `MessageId\n${msg.MessageId}\n` +
    `Timestamp\n${msg.Timestamp}\n` +
    `TopicArn\n${msg.TopicArn}\n` +
    `Type\n${msg.Type}\n`;
  const signer = createSign("SHA1");
  signer.update(signingString);
  return signer.sign(privateKey, "base64");
}

function signSubscriptionConfirmation(msg: SnsMessage): string {
  const signingString =
    `Message\n${msg.Message}\n` +
    `MessageId\n${msg.MessageId}\n` +
    `SubscribeURL\n${msg.SubscribeURL ?? ""}\n` +
    `Timestamp\n${msg.Timestamp}\n` +
    `Token\n${msg.Token ?? ""}\n` +
    `TopicArn\n${msg.TopicArn}\n` +
    `Type\n${msg.Type}\n`;
  const signer = createSign("SHA1");
  signer.update(signingString);
  return signer.sign(privateKey, "base64");
}

function makeNotificationMsg(overrides: Partial<SnsMessage> = {}): SnsMessage {
  const base: SnsMessage = {
    Type: "Notification",
    MessageId: "msg-abc-123",
    TopicArn: "arn:aws:sns:us-east-1:123456789:MyTopic",
    Message: "Hello from SNS",
    Timestamp: "2024-06-01T12:00:00.000Z",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    Signature: "",
    SignatureVersion: "1",
    ...overrides,
  };
  return base;
}

describe("verifySnsMessage — assertAmazonsCertUrl", () => {
  it("rejects when SigningCertURL is not an amazonaws.com host (certFetcher never called)", async () => {
    const certFetcher = vi.fn();
    const msg = makeNotificationMsg({
      SigningCertURL: "https://evil.example.com/cert.pem",
      Signature: "anysig",
    });

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow(
      "amazonaws.com",
    );
    expect(certFetcher).not.toHaveBeenCalled();
  });

  it("rejects when SigningCertURL is a malformed (non-URL) string", async () => {
    const certFetcher = vi.fn();
    const msg = makeNotificationMsg({
      SigningCertURL: "not-a-url-at-all",
      Signature: "anysig",
    });

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow();
    expect(certFetcher).not.toHaveBeenCalled();
  });
});

describe("verifySnsMessage — Notification with real RSA signature", () => {
  it("resolves with parsed message when signature is valid", async () => {
    const base = makeNotificationMsg();
    const signature = signNotification(base);
    const msg = { ...base, Signature: signature };
    const certFetcher = vi.fn().mockResolvedValue(publicKeyPem);

    const result = await verifySnsMessage(JSON.stringify(msg), certFetcher);

    expect(result.Type).toBe("Notification");
    expect(result.Message).toBe("Hello from SNS");
    expect(certFetcher).toHaveBeenCalledWith(msg.SigningCertURL);
  });

  it("rejects with signature-failed error when signature is invalid", async () => {
    const msg = makeNotificationMsg({ Signature: "badsignature==" });
    const certFetcher = vi.fn().mockResolvedValue(publicKeyPem);

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow(
      "SNS message signature verification failed",
    );
  });

  it("rejects when certFetcher returns garbage (not a valid cert)", async () => {
    const base = makeNotificationMsg();
    const signature = signNotification(base);
    const msg = { ...base, Signature: signature };
    const certFetcher = vi.fn().mockResolvedValue("this-is-not-a-pem-cert");

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow();
  });
});

describe("verifySnsMessage — SubscriptionConfirmation with real RSA signature", () => {
  it("resolves with parsed message when signature is valid", async () => {
    const base: SnsMessage = {
      Type: "SubscriptionConfirmation",
      MessageId: "msg-sub-456",
      TopicArn: "arn:aws:sns:us-east-1:123456789:MyTopic",
      Message: "You have chosen to subscribe to the topic",
      Timestamp: "2024-06-01T12:00:00.000Z",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Signature: "",
      SignatureVersion: "1",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm?token=xyz",
      Token: "long-confirmation-token",
    };
    const signature = signSubscriptionConfirmation(base);
    const msg = { ...base, Signature: signature };
    const certFetcher = vi.fn().mockResolvedValue(publicKeyPem);

    const result = await verifySnsMessage(JSON.stringify(msg), certFetcher);

    expect(result.Type).toBe("SubscriptionConfirmation");
    expect(result.Token).toBe("long-confirmation-token");
    expect(certFetcher).toHaveBeenCalledWith(msg.SigningCertURL);
  });
});
