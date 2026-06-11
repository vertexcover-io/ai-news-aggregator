import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Queue, QueueEvents, Worker } from "bullmq";
import { rawItems } from "@newsletter/shared/db";
import {
  handleCollectionJob,
  type CollectionJobLike,
} from "@pipeline/workers/collection.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import { getTestRedis, closeTestRedis } from "@pipeline-tests/e2e/setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

function isCollectorResult(value: unknown): value is CollectorResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "itemsFetched" in value &&
    "commentsFetched" in value &&
    "itemsStored" in value &&
    "durationMs" in value
  );
}

function assertCollectorResult(value: unknown): CollectorResult {
  if (!isCollectorResult(value)) {
    throw new Error(`Expected CollectorResult, got: ${JSON.stringify(value)}`);
  }
  return value;
}

describe("Collection Worker E2E", () => {
  let db: AppDb;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let worker: Worker;

  beforeAll(() => {
    db = getTestDb();
    const connection = getTestRedis();
    queue = new Queue("collection-e2e-test", { connection });
    queueEvents = new QueueEvents("collection-e2e-test", { connection });
    worker = new Worker(
      "collection-e2e-test",
      (job) => handleCollectionJob(job as CollectionJobLike),
      { connection },
    );

    return async () => {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    await queue.obliterate({ force: true });
  });

  it("enqueues hn-collect job, worker processes it, data lands in DB", async () => {
    const job = await queue.add("hn-collect", {
      config: {
        feeds: ["newest"],
        count: 3,
        pointsThreshold: 1,
        commentsPerItem: 0,
      },
    });

    const result = assertCollectorResult(await job.waitUntilFinished(queueEvents, 30000));

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    const rows = await db.select().from(rawItems);
    expect(rows.length).toBeGreaterThanOrEqual(result.itemsStored);
  });

  it("completed job returns CollectorResult with all fields", async () => {
    const job = await queue.add("hn-collect", {
      config: {
        feeds: ["newest"],
        count: 3,
        pointsThreshold: 1,
        commentsPerItem: 0,
      },
    });

    const result = assertCollectorResult(await job.waitUntilFinished(queueEvents, 30000));

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.itemsFetched).toBe("number");
    expect(typeof result.durationMs).toBe("number");
  });

  it("enqueues reddit-collect job, worker processes it, data lands in DB", async () => {
    const job = await queue.add("reddit-collect", {
      config: {
        subreddits: ["MachineLearning"],
        sort: "top",
        timeframe: "week",
        limit: 3,
        commentsPerItem: 0,
      },
    });

    const result = assertCollectorResult(await job.waitUntilFinished(queueEvents, 60000));

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    const rows = await db.select().from(rawItems);
    expect(rows.length).toBeGreaterThanOrEqual(result.itemsStored);
  });

  it("completed reddit-collect job returns CollectorResult with all fields", async () => {
    const job = await queue.add("reddit-collect", {
      config: {
        subreddits: ["MachineLearning"],
        sort: "top",
        timeframe: "week",
        limit: 3,
        commentsPerItem: 0,
      },
    });

    const result = assertCollectorResult(await job.waitUntilFinished(queueEvents, 60000));

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.itemsFetched).toBe("number");
    expect(typeof result.durationMs).toBe("number");
  });

  it("unknown job name results in a failed job", async () => {
    const job = await queue.add("nonexistent-collect", {
      config: {},
    });

    try {
      await job.waitUntilFinished(queueEvents, 10000);
      expect.fail("Job should have failed");
    } catch (err) {
      expect(String(err)).toContain("Unknown collector");
    }
  });
});
