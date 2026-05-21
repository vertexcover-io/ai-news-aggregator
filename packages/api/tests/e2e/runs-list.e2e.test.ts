/**
 * E2E for GET /api/runs (list) (VS-4, REQ-L1..L3).
 * Real Redis (no keys seeded), fake archive repo returns [].
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Queue } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type { RunSummary } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

const redis = createRedisConnection();

function makeRawItemsRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
}

function makeArchiveRepo(): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(null)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(),
    searchReviewed: vi.fn(),
    findMostRecentReviewed: vi.fn(),
    updateRankedItems: vi.fn(),
    findPoolItems: vi.fn(),
    markSlackNotified: vi.fn(),
    markEmailSent: vi.fn(),
    markNotification: vi.fn(),
    markLinkedInPosted: vi.fn(),
    markTwitterPosted: vi.fn(),
    recordSocialFailure: vi.fn(),
    delete: vi.fn(),
  } as unknown as RunArchivesRepo;
}

function buildApp(): Hono {
  const app = new Hono();
  const queue = {
    add: vi.fn(() => Promise.resolve({ id: "noop" })),
    name: "processing",
  };
  app.route(
    "/api/runs",
    createRunsRouter({
      redis,
      processingQueue: queue as unknown as Queue,
      getRawItemsRepo: () => makeRawItemsRepo(),
      getArchiveRepo: () => makeArchiveRepo(),
    }),
  );
  return app;
}

async function deleteAllRunKeys(): Promise<void> {
  const stream = redis.scanStream({ match: "run:*", count: 100 });
  const keys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (batch: string[]) => {
      for (const k of batch) keys.push(k);
    });
    stream.on("end", () => {
      resolve();
    });
    stream.on("error", reject);
  });
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

beforeAll(async () => {
  await redis.ping();
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  await deleteAllRunKeys();
});

describe("GET /api/runs (e2e)", () => {
  it("REQ-L1: returns 200 + { runs: [] } when no limit query", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: RunSummary[] };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toEqual([]);
  });

  it("REQ-L2: returns 200 for limit=5", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs?limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: RunSummary[] };
    expect(body.runs.length).toBeLessThanOrEqual(5);
  });

  it("REQ-L2: returns 200 for limit=100 (boundary)", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs?limit=100");
    expect(res.status).toBe(200);
  });

  it("REQ-L3: returns 400 for limit=0", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs?limit=0");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.startsWith("limit must be an integer")).toBe(true);
  });

  it("REQ-L3: returns 400 for limit=101", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs?limit=101");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.startsWith("limit must be an integer")).toBe(true);
  });

  it("REQ-L3: returns 400 for limit=abc", async () => {
    const app = buildApp();
    const res = await app.request("/api/runs?limit=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.startsWith("limit must be an integer")).toBe(true);
  });
});
