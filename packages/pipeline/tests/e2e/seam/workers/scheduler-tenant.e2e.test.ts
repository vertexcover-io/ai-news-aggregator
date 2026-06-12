import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import type { UserSettings } from "@newsletter/shared";
import { reconcilePipelineSchedule } from "../../../../../api/src/services/scheduler.js";
import {
  closeTestRedis,
  getTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: randomUUID(),
    topN: 5,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { sinceDays: 1, count: 1, feeds: ["newest"], commentsPerItem: 0 },
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "09:30",
    pipelineTime: "09:30",
    emailTime: "10:00",
    linkedinTime: "10:15",
    twitterTime: "10:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "seam ranking prompt",
    shortlistPrompt: "seam shortlist prompt {{N}}",
    shortlistSize: 30,
    updatedAt: new Date("2026-06-10T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

// P10 (REQ-062/063): per-tenant scheduler keys on a REAL BullMQ queue — each
// tenant owns isolated `:`-delimited entries, and one tenant's reconcile
// never disturbs another tenant's standing schedule.
describe("per-tenant pipeline schedulers (real BullMQ queue)", () => {
  let queue: Queue;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeEach(() => {
    queue = new Queue(`scheduler-tenant-e2e-${randomUUID()}`, {
      connection: getTestRedis(),
    });
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("test_REQ_062_per_tenant_scheduler_keys", async () => {
    await reconcilePipelineSchedule(queue, makeSettings(), tenantA);
    await reconcilePipelineSchedule(queue, makeSettings(), tenantB);

    const schedulers = await queue.getJobSchedulers();
    const keys = schedulers.map((s) => s.key);

    // both tenants hold their own full scheduler family, side by side
    for (const tenantId of [tenantA, tenantB]) {
      expect(keys).toContain(`pipeline-run:${tenantId}`);
      expect(keys).toContain(`social-health:${tenantId}`);
      expect(keys).toContain(`email-send:${tenantId}`);
      expect(keys).toContain(`linkedin-post:${tenantId}`);
      expect(keys).toContain(`twitter-post:${tenantId}`);
    }
    // no legacy singleton entries survive a tenant-scoped reconcile
    expect(keys.filter((k) => k.endsWith(":default"))).toEqual([]);
    // each tenant's pipeline-run entry stamps ITS tenant into the job data
    for (const tenantId of [tenantA, tenantB]) {
      const entry = schedulers.find((s) => s.key === `pipeline-run:${tenantId}`);
      expect(entry?.template?.data).toEqual({ tenantId });
    }
  });

  it("test_REQ_063_settings_change_reconciles_only_that_tenant", async () => {
    await reconcilePipelineSchedule(queue, makeSettings(), tenantA);
    await reconcilePipelineSchedule(queue, makeSettings(), tenantB);

    const before = await queue.getJobSchedulers();
    const tenantABefore = before
      .filter((s) => s.key.endsWith(`:${tenantA}`))
      .map((s) => ({ key: s.key, pattern: s.pattern }))
      .sort((x, y) => x.key.localeCompare(y.key));
    expect(tenantABefore).toHaveLength(5);

    // tenant B changes its schedule time and disables LinkedIn
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ pipelineTime: "11:45", linkedinEnabled: false }),
      tenantB,
    );

    const after = await queue.getJobSchedulers();
    // tenant A's entries are byte-identical
    const tenantAAfter = after
      .filter((s) => s.key.endsWith(`:${tenantA}`))
      .map((s) => ({ key: s.key, pattern: s.pattern }))
      .sort((x, y) => x.key.localeCompare(y.key));
    expect(tenantAAfter).toEqual(tenantABefore);
    // tenant B's were updated in place
    const bKeys = after.filter((s) => s.key.endsWith(`:${tenantB}`)).map((s) => s.key);
    expect(bKeys).not.toContain(`linkedin-post:${tenantB}`);
    const bSocialHealth = after.find((s) => s.key === `social-health:${tenantB}`);
    expect(bSocialHealth?.pattern).toBe("30 11 * * *"); // 11:45 − 15min lead

    // disabling tenant B entirely removes ONLY tenant B's family
    await reconcilePipelineSchedule(
      queue,
      makeSettings({ scheduleEnabled: false }),
      tenantB,
    );
    const final = await queue.getJobSchedulers();
    expect(final.filter((s) => s.key.endsWith(`:${tenantB}`))).toEqual([]);
    const tenantAFinal = final
      .filter((s) => s.key.endsWith(`:${tenantA}`))
      .map((s) => ({ key: s.key, pattern: s.pattern }))
      .sort((x, y) => x.key.localeCompare(y.key));
    expect(tenantAFinal).toEqual(tenantABefore);
  });
});
