/**
 * E2E for POST /api/runs/:runId/cancel (VS-3, REQ-C1..C3).
 * Two real Redis connections: one for the router (also publisher), one
 * separate subscriber to verify run:cancel:<id> messages.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Queue } from "bullmq";
import { createRedisConnection, runCancelChannel } from "@newsletter/shared";
import type { RunState } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  RunArchivesRepo,
  RunArchiveRow,
} from "@api/repositories/run-archives.js";

const redis = createRedisConnection();
const subscriber = createRedisConnection();
const seededKeys: string[] = [];

interface ReceivedMessage {
  channel: string;
  msg: string;
}
const received: ReceivedMessage[] = [];

subscriber.on("message", (channel: string, msg: string) => {
  received.push({ channel, msg });
});

function makeRawItemsRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
}

function makeArchiveRepo(archive: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(archive)),
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

function buildApp(opts: { archive?: RunArchiveRow | null }): Hono {
  const app = new Hono();
  const queue = {
    add: vi.fn(() => Promise.resolve({ id: "noop" })),
    name: "processing",
  };
  app.route(
    "/api/runs",
    createRunsRouter({
      redis,
      publisher: redis,
      processingQueue: queue as unknown as Queue,
      getRawItemsRepo: () => makeRawItemsRepo(),
      getArchiveRepo: () => makeArchiveRepo(opts.archive ?? null),
    }),
  );
  return app;
}

function makeRunState(overrides: Partial<RunState> & { id: string }): RunState {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    status: "running",
    stage: "queued",
    topN: 10,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources: { hn: { status: "pending", itemsFetched: 0, errors: [] } },
    rankedItems: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

async function waitForMessage(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (received.length > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  await redis.ping();
  await subscriber.ping();
});

afterAll(async () => {
  await redis.quit();
  await subscriber.quit();
});

afterEach(async () => {
  if (seededKeys.length > 0) {
    await redis.del(...seededKeys);
    seededKeys.length = 0;
  }
  received.length = 0;
});

describe("POST /api/runs/:runId/cancel (e2e)", () => {
  it("REQ-C1: transitions running -> cancelling, publishes one message", async () => {
    const runId = "e2e-cancel-running";
    const state = makeRunState({ id: runId, status: "running" });
    await redis.set(`run:${runId}`, JSON.stringify(state), "EX", 3600);
    seededKeys.push(`run:${runId}`);

    await subscriber.subscribe(runCancelChannel(runId));

    const app = buildApp({});
    const res = await app.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunState };
    expect(body.run.status).toBe("cancelling");

    const raw = await redis.get(`run:${runId}`);
    if (raw === null) throw new Error("expected redis state");
    const updated = JSON.parse(raw) as RunState;
    expect(updated.status).toBe("cancelling");

    await waitForMessage();
    await subscriber.unsubscribe(runCancelChannel(runId));
    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe(runCancelChannel(runId));
  });

  it("REQ-C2: returns 404 when run missing in Redis AND archive", async () => {
    const app = buildApp({ archive: null });
    const res = await app.request("/api/runs/no-such-run/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not found");
  });

  it("REQ-C3: returns 409 with terminal status when run is completed in Redis", async () => {
    const runId = "e2e-cancel-completed";
    const state = makeRunState({
      id: runId,
      status: "completed",
      stage: "completed",
      completedAt: new Date().toISOString(),
    });
    await redis.set(`run:${runId}`, JSON.stringify(state), "EX", 3600);
    seededKeys.push(`run:${runId}`);

    const app = buildApp({});
    const res = await app.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string };
    expect(body.error).toBe("run is not cancellable");
    expect(body.status).toBe("completed");
  });
});
