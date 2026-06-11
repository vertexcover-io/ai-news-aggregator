/**
 * Real-network e2e: pipeline newsletter-send via Resend sandbox addresses.
 *
 * Gated behind RUN_NETWORK_TESTS=1 because it consumes a real Resend API call
 * (free for sandbox addresses but still external network).
 *
 * Resend sandbox addresses (https://resend.com/docs/dashboard/emails/send-test-emails):
 *   delivered@resend.dev — succeeds + delivery webhook
 *   bounced@resend.dev   — succeeds + bounce webhook
 *   complained@resend.dev — succeeds + complaint webhook
 *
 * The default sender `onboarding@resend.dev` works without domain verification,
 * which lets this test run before the news.vertexcover.io DKIM records are live.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import {
  rawItems,
  runArchives,
  subscribers,
  emailSends,
} from "@newsletter/shared/db";
import { handleNewsletterSendJob } from "@pipeline/workers/newsletter-send.js";
import { createPipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import { createPipelineEmailSendsRepo } from "@pipeline/repositories/email-sends.js";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createEmailProvider } from "@pipeline/lib/email-provider.js";
import { renderNewsletter } from "@pipeline/lib/email-render.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { getTestRedis, closeTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { NewsletterSendJobPayload } from "@newsletter/shared";

const REPO_ROOT = findRepoCommonRoot();
config({ path: resolve(REPO_ROOT, ".env.test") });
config({ path: resolve(REPO_ROOT, ".env.harness") });

const RESEND_FROM = "onboarding@resend.dev";
const RESEND_TEST_RECIPIENTS = [
  "delivered@resend.dev",
  "bounced@resend.dev",
  "complained@resend.dev",
] as const;

describe("Newsletter send — real Resend e2e", () => {
  let runArchiveId: string;
  let subscriberIds: string[];
  // tenant_id is NOT NULL on raw_items/run_archives/subscribers/email_sends
  let tenant: TenantContext;

  beforeAll(async () => {
    tenant = await ensurePipelineTenant();
    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith("re_your_")) {
      throw new Error(
        "RESEND_API_KEY missing or placeholder. Set it in .env.harness for this test.",
      );
    }
    process.env.EMAIL_PROVIDER = "resend";
    process.env.SESSION_SECRET ??= "test-session-secret-please-do-not-use-in-prod";
  });

  beforeEach(async () => {
    const db = getTestDb();
    // Clean prior data — order matters for FKs
    await db.delete(emailSends);
    await db.delete(subscribers);
    await db.delete(runArchives);
    await db.delete(rawItems);

    // Seed raw items
    await db.insert(rawItems).values([
      {
        sourceType: "hn",
        tenantId: tenant.tenantId,
        externalId: `e2e-${randomUUID()}`,
        title: "OpenAI ships GPT-9 — preview release notes",
        url: "https://example.com/openai-gpt9",
        publishedAt: new Date(),
        engagement: { points: 100, commentCount: 30 },
        metadata: {
          comments: [],
          recap: {
            title: "OpenAI ships GPT-9",
            summary: "GPT-9 brings 10x throughput and a new tool-use schema.",
            bullets: ["10x throughput on long-context", "Native tool-use schema", "Pricing flat vs GPT-8"],
            bottomLine: "Worth re-running benchmarks against GPT-8.",
          },
        },
      },
      {
        sourceType: "hn",
        tenantId: tenant.tenantId,
        externalId: `e2e-${randomUUID()}`,
        title: "Anthropic launches autonomous agents API",
        url: "https://example.com/anthropic-agents",
        publishedAt: new Date(),
        engagement: { points: 80, commentCount: 22 },
        metadata: {
          comments: [],
          recap: {
            title: "Anthropic launches autonomous agents API",
            summary: "First-class agent framework with stateful memory.",
            bullets: ["Stateful agent memory", "Toolformer integration"],
            bottomLine: "Reduces glue code for agent stacks.",
          },
        },
      },
    ]);

    const insertedRaw = await db.select({ id: rawItems.id }).from(rawItems);
    expect(insertedRaw.length).toBe(2);

    runArchiveId = randomUUID();
    await db.insert(runArchives).values({
      id: runArchiveId,
      tenantId: tenant.tenantId,
      status: "completed",
      rankedItems: insertedRaw.map((row, idx) => ({
        rawItemId: row.id,
        score: 0.9 - idx * 0.1,
        rationale: "seeded",
      })),
      topN: 5,
      reviewed: true,
      completedAt: new Date(),
    });

    const insertedSubs = await db
      .insert(subscribers)
      .values(
        RESEND_TEST_RECIPIENTS.map((email) => ({
          email,
          tenantId: tenant.tenantId,
          status: "confirmed" as const,
          subscribedAt: new Date(),
        })),
      )
      .returning({ id: subscribers.id });
    subscriberIds = insertedSubs.map((s) => s.id);
    expect(subscriberIds).toHaveLength(3);
  });

  it("delivers to all 3 confirmed subscribers via Resend; email_sends rows persisted", async () => {
    const db = getTestDb();
    const connection = getTestRedis();
    const queueName = `newsletter-send-e2e-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const deps = {
      emailProvider: createEmailProvider(),
      subscribersRepo: createPipelineSubscribersRepo(db, tenant),
      emailSendsRepo: createPipelineEmailSendsRepo(db, tenant),
      archiveRepo: createRunArchivesRepo(db, tenant),
      rawItemsRepo: createRawItemsRepo(db, tenant),
      renderNewsletter,
      sessionSecret: process.env.SESSION_SECRET ?? "test-session-secret",
      fromMail: RESEND_FROM,
      replyToEmail: undefined,
      baseUrl: "http://localhost:3000",
    };

    const worker = new Worker<NewsletterSendJobPayload>(
      queueName,
      async (job: Job<NewsletterSendJobPayload>) => {
        await handleNewsletterSendJob(deps, {
          name: job.name,
          id: job.id,
          data: job.data,
        });
      },
      { connection },
    );

    try {
      const job = await queue.add("send-newsletter", {
        runId: runArchiveId,
        subscriberIds: "all",
      });
      await job.waitUntilFinished(queueEvents, 60000);

      const sends = await db
        .select()
        .from(emailSends)
        .where(eq(emailSends.runArchiveId, runArchiveId));

      expect(sends).toHaveLength(3);
      for (const row of sends) {
        expect(row.messageId).toBeTruthy();
        // Resend message ids are UUIDs (e.g. "47b04d34-..."). Just assert truthy + reasonable length.
        expect(row.messageId?.length ?? 0).toBeGreaterThan(8);
      }

      const sentSubscriberIds = new Set(sends.map((s) => s.subscriberId));
      for (const sid of subscriberIds) {
        expect(sentSubscriberIds.has(sid)).toBe(true);
      }
    } finally {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      await closeTestRedis();
    }
  }, 90000);

  it("does not duplicate sends on re-run for same archive (idempotency)", async () => {
    const db = getTestDb();
    const connection = getTestRedis();
    const queueName = `newsletter-send-idem-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const deps = {
      emailProvider: createEmailProvider(),
      subscribersRepo: createPipelineSubscribersRepo(db, tenant),
      emailSendsRepo: createPipelineEmailSendsRepo(db, tenant),
      archiveRepo: createRunArchivesRepo(db, tenant),
      rawItemsRepo: createRawItemsRepo(db, tenant),
      renderNewsletter,
      sessionSecret: process.env.SESSION_SECRET ?? "test-session-secret",
      fromMail: RESEND_FROM,
      replyToEmail: undefined,
      baseUrl: "http://localhost:3000",
    };

    const worker = new Worker<NewsletterSendJobPayload>(
      queueName,
      async (job: Job<NewsletterSendJobPayload>) => {
        await handleNewsletterSendJob(deps, {
          name: job.name,
          id: job.id,
          data: job.data,
        });
      },
      { connection },
    );

    try {
      const j1 = await queue.add("send-newsletter", { runId: runArchiveId, subscriberIds: "all" });
      await j1.waitUntilFinished(queueEvents, 60000);
      const j2 = await queue.add("send-newsletter", { runId: runArchiveId, subscriberIds: "all" });
      await j2.waitUntilFinished(queueEvents, 60000);

      const sends = await db
        .select()
        .from(emailSends)
        .where(eq(emailSends.runArchiveId, runArchiveId));

      expect(sends).toHaveLength(3);
    } finally {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      await closeTestRedis();
    }
  }, 120000);
});
