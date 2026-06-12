/**
 * E2E (seam) coverage for the four new Slack notifier methods introduced by
 * the split-slack-notifications spec:
 *   - notifySourceDistribution
 *   - notifyEmailDelivery
 *   - notifyLinkedinPosted
 *   - notifyTwitterPosted
 *
 * Strategy: stand up the REAL Postgres-backed run-archives repo and the REAL
 * notifier against a stub fetchFn that captures every webhook POST. This
 * proves the end-to-end path that unit tests cannot — that markNotification's
 * `coalesce(notification_state, '{}'::jsonb) || jsonb_build_object($key, $now)`
 * SQL writes the JSONB key correctly on the live row, and that the next call
 * reads it back and short-circuits per REQ-010 idempotency.
 *
 * The pipeline workers themselves (run-process, email-send, linkedin-post,
 * twitter-post) are NOT booted here — their behavior is covered by the unit
 * suites in packages/pipeline/tests/unit/workers/. This file targets the
 * notifier↔repo seam specifically.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createSlackNotifier,
  type SlackNotifier,
  type RunSourceTelemetry,
} from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

const WEBHOOK_URL = "https://hooks.slack.com/services/T_test/B_test/secret";
const logger = createLogger("test:slack-split");

interface CapturedPost {
  url: string;
  blocks: unknown[];
}

interface TestHarness {
  notifier: SlackNotifier;
  captures: CapturedPost[];
  responseStatus: number;
  setResponse(status: number): void;
  archiveRepo: ReturnType<typeof createRunArchivesRepo>;
}

// tenant_id is NOT NULL on run_archives — repo writes stamp the e2e tenant
let tenant: TenantContext;

function buildHarness(): TestHarness {
  const db = getTestDb();
  const archiveRepo = createRunArchivesRepo(db, tenant);
  const captures: CapturedPost[] = [];
  let responseStatus = 200;

  const fetchFn: typeof fetch = ((input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const bodyText = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(bodyText) as { blocks?: unknown[] };
    captures.push({ url, blocks: parsed.blocks ?? [] });
    return Promise.resolve(
      new Response(responseStatus === 200 ? "ok" : "error", {
        status: responseStatus,
      }),
    );
  }) as typeof fetch;

  const notifier = createSlackNotifier({
    webhookUrl: WEBHOOK_URL,
    logger,
    archives: archiveRepo,
    fetchFn,
    publicArchiveBaseUrl: "https://test.example",
    resolveTopRankedTitle: () => Promise.resolve(null),
  });

  return {
    notifier,
    captures,
    responseStatus,
    setResponse(status) {
      responseStatus = status;
    },
    archiveRepo,
  };
}

const SAMPLE_TELEMETRY: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "hn",
      displayName: "Hacker News",
      itemsFetched: 42,
      retries: 0,
      durationMs: 1234,
      status: "completed",
      errors: [],
    },
    {
      sourceType: "reddit",
      identifier: "reddit:MachineLearning",
      displayName: "Reddit r/MachineLearning",
      itemsFetched: 0,
      retries: 2,
      durationMs: 567,
      status: "failed",
      errors: ["503 Service Unavailable"],
    },
  ],
  totalItemsFetched: 42,
  totalErrors: 1,
};

async function insertArchive(
  archiveRepo: ReturnType<typeof createRunArchivesRepo>,
  opts: {
    runId?: string;
    headline?: string | null;
    sourceTelemetry?: RunSourceTelemetry | null;
    isDryRun?: boolean;
  } = {},
): Promise<string> {
  const runId = opts.runId ?? randomUUID();
  await archiveRepo.upsert({
    id: runId,
    status: "completed",
    rankedItems: [],
    topN: 5,
    completedAt: new Date(),
    digestHeadline: opts.headline ?? "Test digest headline",
    digestSummary: null,
    sourceTelemetry:
      opts.sourceTelemetry === undefined ? SAMPLE_TELEMETRY : opts.sourceTelemetry,
    isDryRun: opts.isDryRun ?? false,
  });
  return runId;
}

describe("Slack split-notifications (E2E seam)", () => {
  beforeAll(async () => {
    // Surface env errors early
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — check .env.test");
    }
    tenant = await ensurePipelineTenant();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe("notifySourceDistribution (REQ-001, REQ-002, REQ-010, REQ-011, REQ-012)", () => {
    it("posts the source-distribution message and writes notification_state.sourceDistribution on the real DB row", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifySourceDistribution({ runId });

      expect(h.captures).toHaveLength(1);
      expect(h.captures[0].url).toBe(WEBHOOK_URL);
      const headerBlock = h.captures[0].blocks[0] as { text: { text: string } };
      expect(headerBlock.text.text).toContain("Sources collected");

      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.sourceDistribution).toBeDefined();
    });

    it("skips re-posting when notification_state.sourceDistribution is already set (REQ-010 idempotency)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifySourceDistribution({ runId });
      const captureCountAfterFirst = h.captures.length;
      const firstTimestamp = (await h.archiveRepo.findById(runId))
        ?.notificationState?.sourceDistribution;

      await h.notifier.notifySourceDistribution({ runId });

      expect(h.captures).toHaveLength(captureCountAfterFirst);
      const secondTimestamp = (await h.archiveRepo.findById(runId))
        ?.notificationState?.sourceDistribution;
      expect(secondTimestamp).toBe(firstTimestamp);
    });

    it("skips with no_telemetry log when sourceTelemetry is null (REQ-002)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo, { sourceTelemetry: null });

      await h.notifier.notifySourceDistribution({ runId });

      expect(h.captures).toHaveLength(0);
      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.sourceDistribution).toBeUndefined();
    });

    it("does not mark notification_state when webhook returns 500 (REQ-011)", async () => {
      const h = buildHarness();
      h.setResponse(500);
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifySourceDistribution({ runId });

      expect(h.captures).toHaveLength(1);
      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.sourceDistribution).toBeUndefined();
    });

    it("skips for dry-run archives (REQ-012)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo, { isDryRun: true });

      await h.notifier.notifySourceDistribution({ runId });

      expect(h.captures).toHaveLength(0);
      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.sourceDistribution).toBeUndefined();
    });
  });

  describe("notifyEmailDelivery (REQ-004, REQ-010)", () => {
    const DELIVERY = { attempted: 5, sent: 4, failed: 1, failureReasons: [{ reason: "rate limit", count: 1 }] };

    it("posts and writes notification_state.emailDelivery on the real DB row", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyEmailDelivery({ runId, delivery: DELIVERY });

      expect(h.captures).toHaveLength(1);
      const headerBlock = h.captures[0].blocks[0] as { text: { text: string } };
      expect(headerBlock.text.text).toContain("Newsletter emailed");

      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.emailDelivery).toBeDefined();
    });

    it("is idempotent (REQ-010)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyEmailDelivery({ runId, delivery: DELIVERY });
      await h.notifier.notifyEmailDelivery({ runId, delivery: DELIVERY });

      expect(h.captures).toHaveLength(1);
    });
  });

  describe("notifyLinkedinPosted (REQ-006, REQ-010)", () => {
    const PERMALINK = "urn:li:share:7000000000000000000";

    it("posts and writes notification_state.linkedinPosted on the real DB row", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyLinkedinPosted({ runId, permalink: PERMALINK });

      expect(h.captures).toHaveLength(1);
      const headerBlock = h.captures[0].blocks[0] as { text: { text: string } };
      expect(headerBlock.text.text).toContain("LinkedIn posted");

      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.linkedinPosted).toBeDefined();
    });

    it("is idempotent (REQ-010)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyLinkedinPosted({ runId, permalink: PERMALINK });
      await h.notifier.notifyLinkedinPosted({ runId, permalink: PERMALINK });

      expect(h.captures).toHaveLength(1);
    });
  });

  describe("notifyTwitterPosted (REQ-008, REQ-010)", () => {
    const PERMALINK = "https://x.com/vertexcover/status/1800000000000000000";

    it("posts and writes notification_state.twitterPosted on the real DB row", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyTwitterPosted({ runId, permalink: PERMALINK });

      expect(h.captures).toHaveLength(1);
      const headerBlock = h.captures[0].blocks[0] as { text: { text: string } };
      expect(headerBlock.text.text).toMatch(/Twitter.*posted|X.*posted/i);

      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.twitterPosted).toBeDefined();
    });

    it("is idempotent (REQ-010)", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await h.notifier.notifyTwitterPosted({ runId, permalink: PERMALINK });
      await h.notifier.notifyTwitterPosted({ runId, permalink: PERMALINK });

      expect(h.captures).toHaveLength(1);
    });
  });

  describe("Concurrent JSONB merge (multi-key safety)", () => {
    it("all four keys can be written to the same row without clobbering each other", async () => {
      const h = buildHarness();
      const runId = await insertArchive(h.archiveRepo);

      await Promise.all([
        h.notifier.notifySourceDistribution({ runId }),
        h.notifier.notifyEmailDelivery({
          runId,
          delivery: { attempted: 1, sent: 1, failed: 0 },
        }),
        h.notifier.notifyLinkedinPosted({ runId, permalink: "urn:li:share:1" }),
        h.notifier.notifyTwitterPosted({
          runId,
          permalink: "https://x.com/test/status/1",
        }),
      ]);

      const row = await h.archiveRepo.findById(runId);
      expect(row?.notificationState?.sourceDistribution).toBeDefined();
      expect(row?.notificationState?.emailDelivery).toBeDefined();
      expect(row?.notificationState?.linkedinPosted).toBeDefined();
      expect(row?.notificationState?.twitterPosted).toBeDefined();

      // 4 successful posts ⇒ exactly 4 webhook captures
      expect(h.captures).toHaveLength(4);
    });
  });
});
