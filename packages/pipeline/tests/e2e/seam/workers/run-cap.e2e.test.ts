import { afterEach, afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { parsePipelineRunConcurrency } from "@pipeline/workers/run-process.js";
import { createRedisThrottle } from "@newsletter/shared/services";
import { closeTestRedis, getTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

describe("global run cap (REQ-065) seam e2e", () => {
  let queue: Queue | undefined;
  let worker: Worker | undefined;

  afterEach(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
  });

  afterAll(async () => {
    await closeTestRedis();
  });

  it("at concurrency 1, a second tenant's run starts only after the first completes", async () => {
    const connection = getTestRedis();
    const queueName = `run-cap-e2e-${randomUUID()}`;
    queue = new Queue(queueName, { connection });

    interface Span {
      tenantId: string;
      startedAt: number;
      finishedAt: number;
    }
    const spans: Span[] = [];
    const HANDLER_MS = 150;

    // Stub run-process handler: records start/finish; the cap comes from the
    // same env-parsed concurrency value createRunProcessWorker wires.
    worker = new Worker(
      queueName,
      async (job: Job) => {
        const startedAt = Date.now();
        await delay(HANDLER_MS);
        spans.push({
          tenantId: (job.data as { tenantId: string }).tenantId,
          startedAt,
          finishedAt: Date.now(),
        });
      },
      { connection, concurrency: parsePipelineRunConcurrency(undefined) },
    );

    await queue.add("run-process", { runId: randomUUID(), tenantId: TENANT_A });
    await queue.add("run-process", { runId: randomUUID(), tenantId: TENANT_B });

    const deadline = Date.now() + 5000;
    while (spans.length < 2 && Date.now() < deadline) {
      await delay(25);
    }

    expect(spans).toHaveLength(2);
    const [first, second] = [...spans].sort((a, b) => a.startedAt - b.startedAt);
    expect(new Set([first.tenantId, second.tenantId])).toEqual(
      new Set([TENANT_A, TENANT_B]),
    );
    // The (N+1)th run queues until a slot frees: no overlap at cap 1.
    expect(second.startedAt).toBeGreaterThanOrEqual(first.finishedAt);
  });
});

describe("redis throttle (REQ-068) against real Redis", () => {
  afterAll(async () => {
    await closeTestRedis();
  });

  it("spaces concurrent acquisitions by the configured interval across clients", async () => {
    const redis = getTestRedis();
    const key = `throttle:e2e-${randomUUID()}`;
    const ratePerSecond = 20; // 50ms interval — keeps the test fast
    const makeThrottle = () =>
      createRedisThrottle({ redis, key, ratePerSecond });

    // Two independent throttle instances share state through the Redis key —
    // the cross-process / cross-tenant guarantee.
    const a = makeThrottle();
    const b = makeThrottle();

    const stamps: number[] = [];
    await Promise.all(
      [a, b, a, b].map(async (t) => {
        await t.acquire();
        stamps.push(Date.now());
      }),
    );

    stamps.sort((x, y) => x - y);
    expect(stamps).toHaveLength(4);
    for (let i = 1; i < stamps.length; i++) {
      // Allow small timer slop while proving real spacing happens.
      expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(40);
    }
    await redis.del(key);
  });
});
