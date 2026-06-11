/**
 * E2E tests for GET /api/admin/runs/:runId/observability (run-observability-page).
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 *
 * Covers REQ-020 (200 + payload), REQ-021 (live composition), REQ-022 (historical),
 * REQ-024 (404 for unknown run), REQ-025 (admin gate), REQ-026 (logs ordered by id).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { AGENTLOOP_TENANT_ID, createRedisConnection, runKey } from "@newsletter/shared";
import type { RunSourceTelemetry, RunState } from "@newsletter/shared";
import { getDb, runArchives, runLogs } from "@newsletter/shared/db";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRunLogRepo } from "@api/repositories/run-logs.js";
import { createAdminRunsRouter } from "@api/routes/admin-runs.js";
import { requireAdmin } from "@api/auth/middleware.js";
import { issueToken } from "@api/auth/session.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const SESSION_SECRET = "run-observability-e2e-secret-at-least-32b";

const db = getDb();
const redis = createRedisConnection();
const rawItemsRepo = createRawItemsRepo(db);
const archiveRepo = createRunArchivesRepo(db);
const runLogRepo = createRunLogRepo(db);

const seededRunIds = new Set<string>();
const seededRedisKeys = new Set<string>();

const observabilitySchema = z.object({
  run: z.object({
    runId: z.string(),
    status: z.string(),
    stage: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    isDryRun: z.boolean(),
    reviewed: z.boolean(),
  }),
  funnel: z.object({
    collected: z.number().nullable(),
    deduped: z.number().nullable(),
    shortlisted: z.number().nullable(),
    ranked: z.number().nullable(),
  }),
  sources: z.array(
    z.object({
      sourceType: z.string(),
      identifier: z.string(),
      displayName: z.string(),
      itemsFetched: z.number(),
      status: z.string(),
      errors: z.array(z.string()),
      retries: z.number(),
      durationMs: z.number().nullable(),
    }),
  ),
  enrichment: z
    .object({
      attempted: z.number(),
      ok: z.number(),
      failed: z.number(),
      skipped: z.number(),
      cacheHits: z.number(),
    })
    .nullable(),
  stages: z.array(
    z.object({
      stage: z.string(),
      startedAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      durationMs: z.number().nullable(),
    }),
  ),
  cost: z.unknown().nullable(),
  logs: z.array(z.object({ id: z.number(), level: z.string(), event: z.string() })),
  failures: z.array(z.object({ id: z.number(), level: z.string() })),
  live: z.boolean(),
});

function buildGatedApp(): Hono {
  const app = new Hono();
  app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  app.route(
    "/api/admin/runs",
    createAdminRunsRouter({
      redis,
      getRawItemsRepo: () => rawItemsRepo,
      getArchiveRepo: () => archiveRepo,
      getRunLogRepo: () => runLogRepo,
    }),
  );
  return app;
}

function adminCookie(): string {
  return `admin_session=${issueToken(SESSION_SECRET, Date.now())}`;
}

const telemetry: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "news.ycombinator.com",
      displayName: "Hacker News",
      itemsFetched: 12,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 4200,
    },
    {
      sourceType: "reddit",
      identifier: "r/LocalLLaMA",
      displayName: "r/LocalLLaMA",
      itemsFetched: 0,
      status: "failed",
      errors: ["rate limited"],
      retries: 2,
      durationMs: 900,
    },
  ],
  totalItemsFetched: 12,
  totalErrors: 1,
  enrichment: {
    attempted: 5,
    ok: 4,
    failed: 1,
    skipped: 0,
    cacheHits: 2,
    avgFetchMs: 320,
    skippedReasons: {},
  },
};

async function seedHistoricalRun(): Promise<string> {
  const runId = randomUUID();
  await db.insert(runArchives).values({
    id: runId,
    tenantId: AGENTLOOP_TENANT_ID,
    status: "completed",
    rankedItems: [],
    topN: 10,
    reviewed: true,
    completedAt: new Date("2099-05-01T00:06:00Z"),
    startedAt: new Date("2099-05-01T00:00:00Z"),
    sourceTypes: ["hn", "reddit"],
    sourceTelemetry: telemetry,
    runFunnel: { collected: 12, deduped: 10, shortlisted: 8, ranked: 6 },
  });
  seededRunIds.add(runId);

  await db.insert(runLogs).values([
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "info",
      stage: "collecting",
      source: null,
      event: "stage.start",
      message: "collecting start",
      context: null,
    },
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "info",
      stage: "collecting",
      source: null,
      event: "stage.end",
      message: "collecting end",
      context: { durationMs: 5000 },
    },
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "error",
      stage: "collecting",
      source: "reddit",
      event: "source.failed",
      message: "reddit failed",
      context: { errors: ["rate limited"] },
    },
  ]);
  return runId;
}

async function seedLiveRun(): Promise<string> {
  const runId = randomUUID();
  const state: RunState = {
    id: runId,
    status: "running",
    stage: "ranking",
    topN: 10,
    startedAt: "2099-05-02T00:00:00.000Z",
    updatedAt: "2099-05-02T00:05:00.000Z",
    completedAt: null,
    sources: {
      hn: { status: "completed", itemsFetched: 12, errors: [] },
      reddit: { status: "running", itemsFetched: 3, errors: [] },
    },
    rankedItems: null,
    warnings: [],
    error: null,
  };
  const key = runKey(runId);
  await redis.set(key, JSON.stringify(state));
  seededRedisKeys.add(key);

  await db.insert(runLogs).values([
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "info",
      stage: "queued",
      source: null,
      event: "run.started",
      message: "run started",
      context: null,
    },
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "info",
      stage: "processing",
      source: null,
      event: "stage.result",
      message: "dedup",
      context: { inputCount: 12, outputCount: 10 },
    },
    {
      tenantId: AGENTLOOP_TENANT_ID,
      runId,
      level: "info",
      stage: "shortlisting",
      source: null,
      event: "stage.result",
      message: "shortlist",
      context: { inputCount: 10, outputCount: 8 },
    },
  ]);
  seededRunIds.add(runId);
  return runId;
}

beforeAll(async () => {
  await redis.ping();
});

afterEach(async () => {
  if (seededRunIds.size > 0) {
    await db.delete(runLogs).where(inArray(runLogs.runId, [...seededRunIds]));
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
  if (seededRedisKeys.size > 0) {
    await redis.del(...seededRedisKeys);
    seededRedisKeys.clear();
  }
});

afterAll(async () => {
  await redis.quit();
});

describe("GET /api/admin/runs/:runId/observability (e2e)", () => {
  it("REQ-022/REQ-026: returns 200 + RunObservability for a historical run", async () => {
    const runId = await seedHistoricalRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/observability`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body = observabilitySchema.parse(await res.json());
    expect(body.live).toBe(false);
    expect(body.run.runId).toBe(runId);
    expect(body.run.status).toBe("completed");
    expect(body.funnel).toEqual({ collected: 12, deduped: 10, shortlisted: 8, ranked: 6 });
    expect(body.sources).toHaveLength(2);
    expect(body.enrichment?.attempted).toBe(5);
    // logs ordered by id ascending (REQ-026)
    const ids = body.logs.map((l) => l.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    // failures subset (the source.failed error row)
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.level).toBe("error");
    // stage timing derived from start/end pair
    const collecting = body.stages.find((s) => s.stage === "collecting");
    expect(collecting?.durationMs).toBe(5000);
  });

  it("REQ-020/REQ-021: returns 200 + live=true for an in-flight run with no archive", async () => {
    const runId = await seedLiveRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/observability`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body = observabilitySchema.parse(await res.json());
    expect(body.live).toBe(true);
    expect(body.run.status).toBe("running");
    expect(body.run.stage).toBe("ranking");
    // funnel derived from stage.result logs; ranking not reached => null
    expect(body.funnel.deduped).toBe(10);
    expect(body.funnel.shortlisted).toBe(8);
    expect(body.funnel.ranked).toBeNull();
    // sources from Redis run-state
    expect(body.sources.map((s) => s.sourceType).sort()).toEqual(["hn", "reddit"]);
    expect(body.logs.length).toBe(3);
  });

  it("REQ-024: returns 404 for an unknown runId", async () => {
    const res = await buildGatedApp().request(
      `/api/admin/runs/${randomUUID()}/observability`,
      { headers: { cookie: adminCookie() } },
    );
    expect(res.status).toBe(404);
  });

  it("REQ-025: rejects an unauthenticated request with 401", async () => {
    const runId = await seedHistoricalRun();
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/observability`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID runId", async () => {
    const res = await buildGatedApp().request(
      `/api/admin/runs/not-a-uuid/observability`,
      { headers: { cookie: adminCookie() } },
    );
    expect(res.status).toBe(400);
  });
});
