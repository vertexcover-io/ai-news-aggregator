import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import {
  parseSnsMessageUnchecked,
  verifySnsMessage,
  type SnsMessage,
} from "@api/lib/sns-verifier.js";

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

  it("throws if MessageId field missing", () => {
    const raw = JSON.stringify({ Type: "Notification", TopicArn: "x", Message: "y", SigningCertURL: "z", Signature: "s" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: MessageId");
  });

  it("throws if TopicArn field missing", () => {
    const raw = JSON.stringify({ Type: "Notification", MessageId: "x", Message: "y", SigningCertURL: "z", Signature: "s" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: TopicArn");
  });

  it("throws if Message field missing", () => {
    const raw = JSON.stringify({ Type: "Notification", MessageId: "x", TopicArn: "y", SigningCertURL: "z", Signature: "s" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: Message");
  });

  it("throws if SigningCertURL field missing", () => {
    const raw = JSON.stringify({ Type: "Notification", MessageId: "x", TopicArn: "y", Message: "z", Signature: "s" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: SigningCertURL");
  });

  it("throws if Signature field missing", () => {
    const raw = JSON.stringify({ Type: "Notification", MessageId: "x", TopicArn: "y", Message: "z", SigningCertURL: "u" });
    expect(() => parseSnsMessageUnchecked(raw)).toThrow("SNS message missing required field: Signature");
  });

  it("throws when raw body is a JSON null (non-object)", () => {
    expect(() => parseSnsMessageUnchecked("null")).toThrow("SNS message must be a JSON object");
  });
});

// Generate a real RSA key pair once for verifySnsMessage tests.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;

function signSnsNotification(msg: SnsMessage): string {
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

function signSnsSubscription(msg: SnsMessage): string {
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

describe("verifySnsMessage", () => {
  const baseMsgFields = {
    MessageId: "msg-001",
    TopicArn: "arn:aws:sns:us-east-1:123:MyTopic",
    Message: "hello",
    Timestamp: "2024-01-01T00:00:00.000Z",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    SignatureVersion: "1",
  };

  it("returns parsed message when Notification signature is valid", async () => {
    const partial: SnsMessage = { ...baseMsgFields, Type: "Notification", Signature: "" };
    const sig = signSnsNotification(partial);
    const msg: SnsMessage = { ...partial, Signature: sig };
    const certFetcher = () => Promise.resolve(PUBLIC_KEY_PEM);

    const result = await verifySnsMessage(JSON.stringify(msg), certFetcher);
    expect(result.Type).toBe("Notification");
    expect(result.MessageId).toBe("msg-001");
  });

  it("returns parsed message when SubscriptionConfirmation signature is valid", async () => {
    const partial: SnsMessage = {
      ...baseMsgFields,
      Type: "SubscriptionConfirmation",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/confirm",
      Token: "tok-abc",
      Signature: "",
    };
    const sig = signSnsSubscription(partial);
    const msg: SnsMessage = { ...partial, Signature: sig };
    const certFetcher = () => Promise.resolve(PUBLIC_KEY_PEM);

    const result = await verifySnsMessage(JSON.stringify(msg), certFetcher);
    expect(result.Type).toBe("SubscriptionConfirmation");
  });

  it("calls the injected certFetcher with SigningCertURL", async () => {
    const partial: SnsMessage = { ...baseMsgFields, Type: "Notification", Signature: "" };
    const sig = signSnsNotification(partial);
    const msg: SnsMessage = { ...partial, Signature: sig };
    let capturedUrl = "";
    const certFetcher = (url: string) => {
      capturedUrl = url;
      return Promise.resolve(PUBLIC_KEY_PEM);
    };

    await verifySnsMessage(JSON.stringify(msg), certFetcher);
    expect(capturedUrl).toBe("https://sns.us-east-1.amazonaws.com/cert.pem");
  });

  it("throws when signature verification fails", async () => {
    const msg: SnsMessage = { ...baseMsgFields, Type: "Notification", Signature: "invalidsig==" };
    const certFetcher = () => Promise.resolve(PUBLIC_KEY_PEM);

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow(
      "SNS message signature verification failed",
    );
  });

  it("throws when SigningCertURL is not a valid URL", async () => {
    const msg: SnsMessage = {
      ...baseMsgFields,
      Type: "Notification",
      SigningCertURL: "not-a-url",
      Signature: "sig==",
    };
    const certFetcher = () => Promise.resolve(PUBLIC_KEY_PEM);

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow(
      "Invalid SigningCertURL",
    );
  });

  it("throws when SigningCertURL hostname is not *.amazonaws.com", async () => {
    const msg: SnsMessage = {
      ...baseMsgFields,
      Type: "Notification",
      SigningCertURL: "https://evil.example.com/cert.pem",
      Signature: "sig==",
    };
    const certFetcher = () => Promise.resolve(PUBLIC_KEY_PEM);

    await expect(verifySnsMessage(JSON.stringify(msg), certFetcher)).rejects.toThrow(
      "SigningCertURL host must be *.amazonaws.com",
    );
  });
});
