/**
 * REQ-013: Redis-backed live run state must be tenant-fenced — a tenant
 * admin who learns another tenant's runId can neither read its live state
 * nor cancel its run. Legacy states without a tenantId stay readable
 * (grandfathered: written before the stamp existed).
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { Queue } from "bullmq";
import type { RunState } from "@newsletter/shared";
import { createRunsRouter } from "@api/routes/runs.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_ID = "11111111-2222-4333-8444-555555555555";

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    id: RUN_ID,
    status: "running",
    stage: "collecting",
    topN: 10,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    sources: {},
    rankedItems: null,
    shortlistedItemIds: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function buildApp(opts: { state: RunState | null; sessionTenantId: string }) {
  const store = new Map<string, string>();
  if (opts.state !== null) {
    store.set(`run:${opts.state.id}`, JSON.stringify(opts.state));
  }
  const redis = {
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: vi.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve("OK");
    }),
  };
  const publisher = { publish: vi.fn(() => Promise.resolve(0)) };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("tenantCtx", {
      userId: "u-1",
      tenantId: opts.sessionTenantId,
      role: "tenant_admin",
    });
    await next();
  });
  app.route(
    "/api/runs",
    createRunsRouter({
      redis: redis as unknown as IORedis,
      publisher: publisher as unknown as IORedis,
      processingQueue: { add: vi.fn() } as unknown as Queue,
      getRawItemsRepo: () => ({ findByIds: () => Promise.resolve([]) }) as unknown as RawItemsRepo,
      getArchiveRepo: () =>
        ({ findById: () => Promise.resolve(null), list: () => Promise.resolve([]) }) as unknown as RunArchivesRepo,
    }),
  );
  return { app, store, publisher };
}

describe("test_REQ_013_run_state_tenant_fence", () => {
  it("GET /api/runs/:runId returns 404 for another tenant's live run", async () => {
    const { app } = buildApp({
      state: makeState({ tenantId: TENANT_B }),
      sessionTenantId: TENANT_A,
    });
    const res = await app.request(`/api/runs/${RUN_ID}`);
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId returns the state for the owning tenant", async () => {
    const { app } = buildApp({
      state: makeState({ tenantId: TENANT_A }),
      sessionTenantId: TENANT_A,
    });
    const res = await app.request(`/api/runs/${RUN_ID}`);
    expect(res.status).toBe(200);
  });

  it("GET /api/runs/:runId keeps legacy states (no tenantId) readable", async () => {
    const { app } = buildApp({
      state: makeState(),
      sessionTenantId: TENANT_A,
    });
    const res = await app.request(`/api/runs/${RUN_ID}`);
    expect(res.status).toBe(200);
  });

  it("POST /api/runs/:runId/cancel returns 404 for another tenant's live run and publishes nothing", async () => {
    const { app, store, publisher } = buildApp({
      state: makeState({ tenantId: TENANT_B }),
      sessionTenantId: TENANT_A,
    });
    const res = await app.request(`/api/runs/${RUN_ID}/cancel`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(publisher.publish).not.toHaveBeenCalled();
    const after = JSON.parse(store.get(`run:${RUN_ID}`) ?? "{}") as RunState;
    expect(after.status).toBe("running");
  });

  it("POST /api/runs/:runId/cancel cancels the owning tenant's run", async () => {
    const { app, publisher } = buildApp({
      state: makeState({ tenantId: TENANT_A }),
      sessionTenantId: TENANT_A,
    });
    const res = await app.request(`/api/runs/${RUN_ID}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(publisher.publish).toHaveBeenCalledOnce();
  });
});
