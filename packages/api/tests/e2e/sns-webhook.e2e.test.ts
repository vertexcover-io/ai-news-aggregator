/**
 * SNS webhook e2e — verifies REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-032
 * and EDGE-008, EDGE-009, EDGE-010, EDGE-016 with real signed payloads.
 *
 * Strategy:
 *  - Generate a self-signed RSA-2048 key pair in beforeAll.
 *  - Build SNS Notification payloads, sign them with the private key.
 *  - Inject a certFetcher into verifySnsMessage that returns the matching public PEM.
 *  - Hit the webhooks router via a fully-wired Hono app and a real Postgres DB.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import forge from "node-forge";
import { Hono } from "hono";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import {
  subscribers,
  sesEvents,
  emailSends,
  runArchives,
} from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared";
import { createWebhooksRouter } from "@api/routes/webhooks.js";
import { createSesEventsRepo } from "@api/repositories/ses-events.js";
import { createEmailSendsRepo } from "@api/repositories/email-sends.js";
import { createSubscribersRepo } from "@api/repositories/subscribers.js";
import {
  verifySnsMessage,
  type CertFetcher,
} from "@api/lib/sns-verifier.js";

function findRepoCommonRoot(): string {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      encoding: "utf8",
    }).trim();
    return resolve(gitCommonDir, "..");
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = findRepoCommonRoot();
config({ path: resolve(REPO_ROOT, ".env") });
config({ path: resolve(REPO_ROOT, ".env.test"), override: false });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL not set");
}

const sql = postgres(databaseUrl);
const db = drizzle(sql);

interface KeyPair {
  privatePem: string;
  certPem: string;
}

let keys: KeyPair;
let badKeys: KeyPair;

function selfSignedCert(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  // Build x509 cert containing the public key, using node-forge.
  const forgeKey = forge.pki.publicKeyFromPem(publicPem);
  const forgePriv = forge.pki.privateKeyFromPem(privatePem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forgeKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "sns.us-east-1.amazonaws.com" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgePriv, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  return { privatePem, certPem };
}

interface NotificationInput {
  innerMessage: object;
  topicArn?: string;
  messageId?: string;
  signWithKey?: string;
}

function buildSignedNotification(input: NotificationInput): string {
  const messageId = input.messageId ?? randomUUID();
  const topicArn =
    input.topicArn ?? "arn:aws:sns:us-east-1:183017936378:newsletter-ses-events";
  const timestamp = new Date().toISOString();
  const message = JSON.stringify(input.innerMessage);
  const type = "Notification";
  const signingString =
    `Message\n${message}\n` +
    `MessageId\n${messageId}\n` +
    `Timestamp\n${timestamp}\n` +
    `TopicArn\n${topicArn}\n` +
    `Type\n${type}\n`;
  const signer = createSign("RSA-SHA1");
  signer.update(signingString);
  const signature = signer.sign(input.signWithKey ?? keys.privatePem, "base64");
  return JSON.stringify({
    Type: type,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: message,
    Timestamp: timestamp,
    SignatureVersion: "1",
    Signature: signature,
    SigningCertURL:
      "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
  });
}

interface SubConfirmInput {
  token: string;
  subscribeURL: string;
  topicArn?: string;
}

function buildSignedSubscriptionConfirmation(input: SubConfirmInput): string {
  const messageId = randomUUID();
  const topicArn = input.topicArn ?? "arn:aws:sns:us-east-1:183017936378:newsletter-ses-events";
  const timestamp = new Date().toISOString();
  const message = "You have chosen to subscribe to the topic";
  const type = "SubscriptionConfirmation";
  const signingString =
    `Message\n${message}\n` +
    `MessageId\n${messageId}\n` +
    `SubscribeURL\n${input.subscribeURL}\n` +
    `Timestamp\n${timestamp}\n` +
    `Token\n${input.token}\n` +
    `TopicArn\n${topicArn}\n` +
    `Type\n${type}\n`;
  const signer = createSign("RSA-SHA1");
  signer.update(signingString);
  const signature = signer.sign(keys.privatePem, "base64");
  return JSON.stringify({
    Type: type,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: message,
    Timestamp: timestamp,
    Token: input.token,
    SubscribeURL: input.subscribeURL,
    SignatureVersion: "1",
    Signature: signature,
    SigningCertURL:
      "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
  });
}

function buildApp(certFetcher: CertFetcher): Hono {
  const logger = createLogger("test-sns-webhook");
  const app = new Hono();
  app.route(
    "/api/webhooks",
    createWebhooksRouter({
      sesEventsRepo: createSesEventsRepo(db),
      emailSendsRepo: createEmailSendsRepo(db),
      subscribersRepo: createSubscribersRepo(db),
      verifySns: (raw: string) => verifySnsMessage(raw, certFetcher),
      logger,
    }),
  );
  return app;
}

const allowAllCertFetcher: CertFetcher = () => Promise.resolve(keys.certPem);

async function insertSubscriber(email: string, status: "confirmed" | "pending" = "confirmed") {
  const [row] = await db
    .insert(subscribers)
    .values({
      email,
      status,
      subscribedAt: new Date(),
    })
    .returning();
  return row;
}

async function insertRunArchive() {
  const [row] = await db
    .insert(runArchives)
    .values({
      id: randomUUID(),
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: true,
      completedAt: new Date(),
    })
    .returning();
  return row;
}

async function insertEmailSend(
  subscriberId: string,
  runArchiveId: string,
  messageId: string,
) {
  const [row] = await db
    .insert(emailSends)
    .values({ subscriberId, runArchiveId, messageId })
    .returning();
  return row;
}

beforeAll(() => {
  keys = selfSignedCert();
  badKeys = selfSignedCert();
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  // Tests use unique messageIds & emails — no global truncate needed (other
  // e2e suites coexist in the same DB). We only clean rows we ourselves create
  // via tagged unique values.
});

describe("SNS webhook — signed payloads (e2e)", () => {
  it("REQ-019: permanent bounce marks subscriber bounced and stores ses_events row", async () => {
    const app = buildApp(allowAllCertFetcher);
    const email = `e2e-bounce-${randomUUID()}@example.com`;
    const sub = await insertSubscriber(email);
    const archive = await insertRunArchive();
    const messageId = `msg-bounce-${randomUUID()}`;
    await insertEmailSend(sub.id, archive.id, messageId);

    const body = buildSignedNotification({
      innerMessage: {
        notificationType: "Bounce",
        mail: {
          messageId,
          timestamp: new Date().toISOString(),
          source: "newsletter@news.vertexcover.io",
          destination: [email],
        },
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ emailAddress: email }],
        },
      },
    });

    const res = await app.request("/api/webhooks/ses", {
      method: "POST",
      body,
    });
    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(sesEvents)
      .where(and(eq(sesEvents.messageId, messageId), eq(sesEvents.eventType, "bounce")));
    expect(events.length).toBe(1);

    const updated = await db.select().from(subscribers).where(eq(subscribers.id, sub.id));
    expect(updated[0]?.status).toBe("bounced");
  });

  it("REQ-019/EDGE-008: transient bounce records event but does NOT mark subscriber bounced", async () => {
    const app = buildApp(allowAllCertFetcher);
    const email = `e2e-transient-${randomUUID()}@example.com`;
    const sub = await insertSubscriber(email);
    const archive = await insertRunArchive();
    const messageId = `msg-transient-${randomUUID()}`;
    await insertEmailSend(sub.id, archive.id, messageId);

    const body = buildSignedNotification({
      innerMessage: {
        notificationType: "Bounce",
        mail: {
          messageId,
          timestamp: new Date().toISOString(),
          source: "newsletter@news.vertexcover.io",
          destination: [email],
        },
        bounce: {
          bounceType: "Transient",
          bounceSubType: "MailboxFull",
          bouncedRecipients: [{ emailAddress: email }],
        },
      },
    });

    const res = await app.request("/api/webhooks/ses", { method: "POST", body });
    expect(res.status).toBe(200);

    const events = await db
      .select()
      .from(sesEvents)
      .where(eq(sesEvents.messageId, messageId));
    expect(events.length).toBe(1);
    const after = await db.select().from(subscribers).where(eq(subscribers.id, sub.id));
    expect(after[0]?.status).toBe("confirmed");
  });

  it("REQ-020: complaint marks subscriber complained", async () => {
    const app = buildApp(allowAllCertFetcher);
    const email = `e2e-complaint-${randomUUID()}@example.com`;
    const sub = await insertSubscriber(email);
    const archive = await insertRunArchive();
    const messageId = `msg-complaint-${randomUUID()}`;
    await insertEmailSend(sub.id, archive.id, messageId);

    const body = buildSignedNotification({
      innerMessage: {
        notificationType: "Complaint",
        mail: {
          messageId,
          timestamp: new Date().toISOString(),
          source: "newsletter@news.vertexcover.io",
          destination: [email],
        },
        complaint: {
          complainedRecipients: [{ emailAddress: email }],
        },
      },
    });

    const res = await app.request("/api/webhooks/ses", { method: "POST", body });
    expect(res.status).toBe(200);

    const after = await db.select().from(subscribers).where(eq(subscribers.id, sub.id));
    expect(after[0]?.status).toBe("complained");
  });

  it("REQ-021: delivery, open, click events are stored without subscriber status change", async () => {
    const app = buildApp(allowAllCertFetcher);
    const email = `e2e-events-${randomUUID()}@example.com`;
    const sub = await insertSubscriber(email);
    const archive = await insertRunArchive();
    const baseMid = `msg-evt-${randomUUID()}`;
    await insertEmailSend(sub.id, archive.id, baseMid);

    for (const notificationType of ["Delivery", "Open", "Click"] as const) {
      const body = buildSignedNotification({
        innerMessage: {
          notificationType,
          mail: {
            messageId: baseMid,
            timestamp: new Date().toISOString(),
            source: "newsletter@news.vertexcover.io",
            destination: [email],
          },
          ...(notificationType === "Open"
            ? { open: { timestamp: new Date().toISOString(), userAgent: "ua", ipAddress: "1.1.1.1" } }
            : {}),
          ...(notificationType === "Click"
            ? { click: { timestamp: new Date().toISOString(), link: "https://example.com" } }
            : {}),
        },
      });
      const res = await app.request("/api/webhooks/ses", { method: "POST", body });
      expect(res.status).toBe(200);
    }

    const events = await db
      .select()
      .from(sesEvents)
      .where(eq(sesEvents.messageId, baseMid));
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(["click", "delivery", "open"]);

    const after = await db.select().from(subscribers).where(eq(subscribers.id, sub.id));
    expect(after[0]?.status).toBe("confirmed");
  });

  it("REQ-023/EDGE-009: duplicate bounce event does not create duplicate ses_events row", async () => {
    const app = buildApp(allowAllCertFetcher);
    const email = `e2e-dedup-${randomUUID()}@example.com`;
    const sub = await insertSubscriber(email);
    const archive = await insertRunArchive();
    const messageId = `msg-dedup-${randomUUID()}`;
    await insertEmailSend(sub.id, archive.id, messageId);

    const buildBody = () =>
      buildSignedNotification({
        innerMessage: {
          notificationType: "Bounce",
          mail: {
            messageId,
            timestamp: new Date().toISOString(),
            source: "newsletter@news.vertexcover.io",
            destination: [email],
          },
          bounce: {
            bounceType: "Permanent",
            bounceSubType: "General",
            bouncedRecipients: [{ emailAddress: email }],
          },
        },
      });

    const r1 = await app.request("/api/webhooks/ses", { method: "POST", body: buildBody() });
    const r2 = await app.request("/api/webhooks/ses", { method: "POST", body: buildBody() });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const events = await db
      .select()
      .from(sesEvents)
      .where(and(eq(sesEvents.messageId, messageId), eq(sesEvents.eventType, "bounce")));
    expect(events.length).toBe(1);
  });

  it("REQ-032/EDGE-016: invalid signature returns 400 and no event is persisted", async () => {
    const app = buildApp(allowAllCertFetcher);
    const messageId = `msg-badsig-${randomUUID()}`;
    const body = buildSignedNotification({
      messageId,
      signWithKey: badKeys.privatePem,
      innerMessage: {
        notificationType: "Bounce",
        mail: {
          messageId,
          timestamp: new Date().toISOString(),
          source: "newsletter@news.vertexcover.io",
          destination: ["x@example.com"],
        },
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ emailAddress: "x@example.com" }],
        },
      },
    });
    const res = await app.request("/api/webhooks/ses", { method: "POST", body });
    expect(res.status).toBe(400);

    const events = await db
      .select()
      .from(sesEvents)
      .where(eq(sesEvents.messageId, messageId));
    expect(events.length).toBe(0);
  });

  it("REQ-022/EDGE-010: SubscriptionConfirmation triggers SubscribeURL fetch", async () => {
    const fetched: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      fetched.push(u);
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;

    try {
      const app = buildApp(allowAllCertFetcher);
      const subUrl =
        "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=zzz";
      const body = buildSignedSubscriptionConfirmation({
        token: "zzz",
        subscribeURL: subUrl,
      });
      const res = await app.request("/api/webhooks/ses", { method: "POST", body });
      expect(res.status).toBe(200);
      expect(fetched).toContain(subUrl);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
