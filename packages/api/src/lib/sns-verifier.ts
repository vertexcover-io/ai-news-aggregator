import { createVerify } from "crypto";
import { get as httpsGet } from "https";

export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SubscribeURL?: string;
  Token?: string;
  SigningCertURL: string;
  Signature: string;
  SignatureVersion: string;
}

function assertAmazonsCertUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid SigningCertURL");
  }
  if (!parsed.hostname.endsWith(".amazonaws.com")) {
    throw new Error(`SigningCertURL host must be *.amazonaws.com, got: ${parsed.hostname}`);
  }
}

function buildSigningString(msg: SnsMessage): string {
  // SNS signs key\nvalue\n pairs in alphabetical key order.
  // The set of keys differs by message type.
  if (msg.Type === "Notification") {
    return (
      `Message\n${msg.Message}\n` +
      `MessageId\n${msg.MessageId}\n` +
      `Timestamp\n${msg.Timestamp}\n` +
      `TopicArn\n${msg.TopicArn}\n` +
      `Type\n${msg.Type}\n`
    );
  }
  // SubscriptionConfirmation and UnsubscribeConfirmation
  return (
    `Message\n${msg.Message}\n` +
    `MessageId\n${msg.MessageId}\n` +
    `SubscribeURL\n${msg.SubscribeURL ?? ""}\n` +
    `Timestamp\n${msg.Timestamp}\n` +
    `Token\n${msg.Token ?? ""}\n` +
    `TopicArn\n${msg.TopicArn}\n` +
    `Type\n${msg.Type}\n`
  );
}

function fetchCert(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

export function parseSnsMessageUnchecked(rawBody: string): SnsMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("SNS message is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("SNS message must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.Type) {
    throw new Error("SNS message missing required field: Type");
  }
  return obj as unknown as SnsMessage;
}

export async function verifySnsMessage(rawBody: string): Promise<SnsMessage> {
  const msg = parseSnsMessageUnchecked(rawBody);

  assertAmazonsCertUrl(msg.SigningCertURL);

  const cert = await fetchCert(msg.SigningCertURL);
  const signingString = buildSigningString(msg);

  const verifier = createVerify("SHA1");
  verifier.update(signingString);

  const valid = verifier.verify(cert, msg.Signature, "base64");
  if (!valid) {
    throw new Error("SNS message signature verification failed");
  }

  return msg;
}
