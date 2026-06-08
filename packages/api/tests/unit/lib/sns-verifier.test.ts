import { createSign, generateKeyPairSync } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { parseSnsMessageUnchecked, verifySnsMessage } from "@api/lib/sns-verifier.js";

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

describe("verifySnsMessage", () => {
  it("rejects when SigningCertURL is not an *.amazonaws.com host", async () => {
    const certFetcher = vi.fn(() => Promise.resolve("fake-cert"));
    const raw = makeSnsJson({
      SigningCertURL: "https://evil.example.com/cert.pem",
    });

    await expect(verifySnsMessage(raw, certFetcher)).rejects.toThrow(
      "SigningCertURL host must be *.amazonaws.com",
    );
  });

  it("does not call certFetcher when SigningCertURL host is invalid", async () => {
    const certFetcher = vi.fn(() => Promise.resolve("fake-cert"));
    const raw = makeSnsJson({
      SigningCertURL: "https://evil.example.com/cert.pem",
    });

    await expect(verifySnsMessage(raw, certFetcher)).rejects.toThrow();
    expect(certFetcher).not.toHaveBeenCalled();
  });

  it("rejects when SigningCertURL is completely invalid (not a URL)", async () => {
    const certFetcher = vi.fn(() => Promise.resolve("fake-cert"));
    const raw = makeSnsJson({
      SigningCertURL: "not-a-url-at-all",
    });

    await expect(verifySnsMessage(raw, certFetcher)).rejects.toThrow("Invalid SigningCertURL");
  });

  it("does not call certFetcher when SigningCertURL is not a valid URL", async () => {
    const certFetcher = vi.fn(() => Promise.resolve("fake-cert"));
    const raw = makeSnsJson({
      SigningCertURL: "not-a-url-at-all",
    });

    await expect(verifySnsMessage(raw, certFetcher)).rejects.toThrow();
    expect(certFetcher).not.toHaveBeenCalled();
  });

  it("rejects when certFetcher returns a cert that does not verify the signature", async () => {
    // Use a real key pair so the signing string is well-formed but sign with
    // a different (wrong) key, making the cert verification fail.
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const wrongPublicPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;

    // Provide an obviously wrong signature
    const raw = makeSnsJson({
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Signature: Buffer.from("invalid-signature").toString("base64"),
    });
    const certFetcher = vi.fn(() => Promise.resolve(wrongPublicPem));

    await expect(verifySnsMessage(raw, certFetcher)).rejects.toThrow(
      "SNS message signature verification failed",
    );
  });

  it("resolves with the parsed message when signature is valid", async () => {
    // Generate an RSA key pair and sign the real SNS signing string.
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pubPem = publicKey.export({ type: "pkcs1", format: "pem" }) as string;

    const msgFields = {
      Type: "Notification" as const,
      MessageId: "test-msg-id",
      TopicArn: "arn:aws:sns:us-east-1:123456789:MyTopic",
      Message: '{"notificationType":"Delivery"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      SignatureVersion: "1",
    };

    // Build the canonical SNS signing string for Notification type
    const signingString =
      `Message\n${msgFields.Message}\n` +
      `MessageId\n${msgFields.MessageId}\n` +
      `Timestamp\n${msgFields.Timestamp}\n` +
      `TopicArn\n${msgFields.TopicArn}\n` +
      `Type\n${msgFields.Type}\n`;

    const signer = createSign("SHA1");
    signer.update(signingString);
    const signature = signer.sign(privateKey, "base64");

    const raw = JSON.stringify({ ...msgFields, Signature: signature });
    const certFetcher = vi.fn(() => Promise.resolve(pubPem));

    const result = await verifySnsMessage(raw, certFetcher);
    expect(result.MessageId).toBe("test-msg-id");
    expect(result.Type).toBe("Notification");
  });
});
