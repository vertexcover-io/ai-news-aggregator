/**
 * E2E for POST /api/runs/now (VS-2, REQ-N1..N5).
 * Real Redis, fake processing Queue, fake settings + archive repos.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { setTestTenant } from "../helpers/tenant.js";
import { Hono } from "hono";
import type { Queue, JobsOptions } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type {
  RunState,
  UserSettings,
  RunProcessJobPayload,
} from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { SourceRecord, SourcesRepo } from "@api/repositories/sources.js";

const redis = createRedisConnection();
const seededKeys: string[] = [];

interface QueueAddCall {
  name: string;
  data: RunProcessJobPayload;
  opts?: JobsOptions;
}

function makeQueue(): {
  queue: { add: ReturnType<typeof vi.fn>; name: string };
  add: ReturnType<typeof vi.fn>;
  calls: QueueAddCall[];
} {
  const calls: QueueAddCall[] = [];
  const add = vi.fn(
    (name: string, data: RunProcessJobPayload, opts?: JobsOptions) => {
      calls.push({ name, data, opts });
      return Promise.resolve({ id: opts?.jobId ?? `job-${name}` });
    },
  );
  return { add, calls, queue: { add, name: "processing" } };
}

function makeRawItemsRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
}

function makeSettingsRepo(settings: UserSettings | null): UserSettingsRepo {
  return {
    get: vi.fn(() => Promise.resolve(settings)),
    upsert: vi.fn(),
  };
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

function buildSettings(overrides?: Partial<UserSettings>): UserSettings {
  const base: UserSettings = {
    id: "singleton",
    topN: 10,
    halfLifeHours: null,
    hnEnabled: true,
    hnConfig: { sinceDays: 1, pointsThreshold: 50 },
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
    scheduleTime: "08:00",
    pipelineTime: "08:00",
    emailTime: "08:30",
    linkedinTime: "08:30",
    twitterTime: "08:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    updatedAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

const defaultSourceRows: SourceRecord[] = [
  {
    id: "99999999-9999-4999-8999-999999999999",
    type: "hn",
    config: { sinceDays: 1, pointsThreshold: 50 },
    enabled: true,
    health: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SourceRecord,
];

function makeSourcesRepo(rows: SourceRecord[]): SourcesRepo {
  return {
    list: vi.fn(() => Promise.resolve(rows)),
    listEnabled: vi.fn(() => Promise.resolve(rows.filter((r) => r.enabled))),
    getById: vi.fn(() => Promise.resolve(null)),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateHealth: vi.fn(),
  } as unknown as SourcesRepo;
}

function buildApp(opts: {
  q: ReturnType<typeof makeQueue>;
  settings: UserSettings | null;
  sourceRows?: SourceRecord[];
}): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  app.route(
    "/api/runs",
    createRunsRouter({
      redis,
      processingQueue: opts.q.queue as unknown as Queue,
      getRawItemsRepo: () => makeRawItemsRepo(),
      getSettingsRepo: () => makeSettingsRepo(opts.settings),
      getSourcesRepo: () => makeSourcesRepo(opts.sourceRows ?? defaultSourceRows),
      getArchiveRepo: () => makeArchiveRepo(),
    }),
  );
  return app;
}

beforeAll(async () => {
  await redis.ping();
});

afterAll(async () => {
  await redis.quit();
});

afterEach(async () => {
  if (seededKeys.length > 0) {
    await redis.del(...seededKeys);
    seededKeys.length = 0;
  }
});

describe("POST /api/runs/now (e2e)", () => {
  it("REQ-N1: returns 202 + runId; enqueues exactly one run-process job with jobId=runId", async () => {
    const q = makeQueue();
    const app = buildApp({ q, settings: buildSettings() });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    seededKeys.push(`run:${body.runId}`);

    expect(q.calls).toHaveLength(1);
    const call = q.calls[0];
    expect(call.name).toBe("run-process");
    expect(call.opts?.jobId).toBe(body.runId);

    const raw = await redis.get(`run:${body.runId}`);
    if (raw === null) throw new Error("expected redis state");
    const state = JSON.parse(raw) as RunState;
    expect(state.status).toBe("running");
    expect(state.sources.hn).toBeDefined();
  });

  it("REQ-N2: returns 409 when settings repo returns null; queue not called", async () => {
    const q = makeQueue();
    const app = buildApp({ q, settings: null });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("settings not configured");
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-N3: returns 409 when no enabled source rows exist; queue not called", async () => {
    const q = makeQueue();
    const settings = buildSettings({ hnEnabled: false, hnConfig: null });
    const app = buildApp({ q, settings, sourceRows: [] });
    const res = await app.request("/api/runs/now", { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no sources enabled");
    expect(q.calls).toHaveLength(0);
  });

  it("REQ-N4: dryRun: true is propagated to the enqueued job payload", async () => {
    const q = makeQueue();
    const app = buildApp({ q, settings: buildSettings() });
    const res = await app.request("/api/runs/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { runId: string };
    seededKeys.push(`run:${body.runId}`);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].data.dryRun).toBe(true);
  });

  it("REQ-N5: rejects non-boolean dryRun with 400; queue not called", async () => {
    const q = makeQueue();
    const app = buildApp({ q, settings: buildSettings() });
    const res = await app.request("/api/runs/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: "yes" }),
    });
    expect(res.status).toBe(400);
    expect(q.calls).toHaveLength(0);
  });
});
