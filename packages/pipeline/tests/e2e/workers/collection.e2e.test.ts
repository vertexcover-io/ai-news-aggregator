import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { Queue, Worker, type Job } from "bullmq";
import { rawItems } from "@newsletter/shared/db";
import { handleCollectionJob } from "../../../src/workers/collection.js";
import { getTestDb, truncateAll, closeTestDb } from "../setup/test-db.js";
import { getTestRedis, cleanQueues, closeTestRedis } from "../setup/test-redis.js";
import type { AppDb } from "@newsletter/shared/db";
import type { CollectorResult } from "@newsletter/shared/types";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe("Collection Worker E2E", () => {
  let db: AppDb;
  let queue: Queue;
  let worker: Worker;

  beforeAll(() => {
    db = getTestDb();
    const connection = getTestRedis();
    queue = new Queue("collection-e2e-test", { connection });
    worker = new Worker(
      "collection-e2e-test",
      handleCollectionJob,
      { connection },
    );

    return async () => {
      await worker.close();
      await queue.close();
      await closeTestRedis();
      await closeTestDb();
    };
  });

  beforeEach(async () => {
    await truncateAll();
    await queue.obliterate({ force: true });
  });

  it("enqueues hn-collect job, worker processes it, data lands in DB", async () => {
    const job = await queue.add("hn-collect", {
      sourceId: null,
      config: {
        feeds: ["newest"],
        count: 3,
        pointsThreshold: 1,
        commentsPerItem: 0,
      },
    });

    const result = await job.waitUntilFinished(queue.events, 30000) as CollectorResult;

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsStored).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);

    const rows = await db.select().from(rawItems);
    expect(rows.length).toBe(result.itemsStored);
  });

  it("completed job returns CollectorResult with all fields", async () => {
    const job = await queue.add("hn-collect", {
      sourceId: null,
      config: {
        feeds: ["newest"],
        count: 3,
        pointsThreshold: 1,
        commentsPerItem: 0,
      },
    });

    const result = await job.waitUntilFinished(queue.events, 30000) as CollectorResult;

    expect(result).toHaveProperty("itemsFetched");
    expect(result).toHaveProperty("commentsFetched");
    expect(result).toHaveProperty("itemsStored");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.itemsFetched).toBe("number");
    expect(typeof result.durationMs).toBe("number");
  });

  it("unknown job name results in a failed job", async () => {
    const job = await queue.add("nonexistent-collect", {
      sourceId: null,
      config: {},
    });

    try {
      await job.waitUntilFinished(queue.events, 10000);
      expect.fail("Job should have failed");
    } catch (err) {
      expect(String(err)).toContain("Unknown collector");
    }
  });
});
