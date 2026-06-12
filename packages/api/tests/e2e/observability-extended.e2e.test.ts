/**
 * E2E tests for run-telemetry-live-logs (VS-6, VS-7, VS-8).
 *
 * Covers:
 *  - VS-6: GET /api/admin/runs/:runId/observability surfaces the new web-collector,
 *          crawler, and link-enrichment events in `logs[]` and error rows in `failures[]`,
 *          preserving the verbose `context` payload.
 *  - VS-7: GET /api/admin/runs/:runId/sources/blog:cursor.com/items resolves to the
 *          three seeded raw_items after Phase 2's identifier alignment fix.
 *  - VS-8: Legacy archive whose sourceTelemetry identifier is a listing URL
 *          (pre-fix shape) still returns 200 with empty items — no crash.
 *
 * Requires Postgres + Redis from `pnpm infra:up`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setTestTenant } from "../helpers/tenant.js";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { inArray } from "drizzle-orm";
import { createRedisConnection } from "@newsletter/shared";
import type { RunSourceTelemetry } from "@newsletter/shared";
import { getDb, rawItems, runArchives, runLogs } from "@newsletter/shared/db";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRunLogRepo } from "@api/repositories/run-logs.js";
import { createAdminRunsRouter } from "@api/routes/admin-runs.js";
import { requireUser } from "@api/auth/middleware.js";
import { makeSessionCookie } from "@api-tests/helpers/auth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const SESSION_SECRET = "observability-extended-e2e-secret-at-least-32b";

const db = getDb();
const redis = createRedisConnection();
const rawItemsRepo = createRawItemsRepo(db, TENANT_ZERO_ID);
const archiveRepo = createRunArchivesRepo(db, TENANT_ZERO_ID);
const runLogRepo = createRunLogRepo(db, TENANT_ZERO_ID);

const seededRunIds = new Set<string>();
const seededRawItemIds = new Set<number>();

function buildGatedApp(): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  app.use("/api/admin/*", requireUser(SESSION_SECRET));
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
  return makeSessionCookie(SESSION_SECRET);
}

beforeAll(async () => {
  await redis.ping();
});

afterEach(async () => {
  if (seededRawItemIds.size > 0) {
    await db.delete(rawItems).where(inArray(rawItems.id, [...seededRawItemIds]));
    seededRawItemIds.clear();
  }
  if (seededRunIds.size > 0) {
    await db.delete(runLogs).where(inArray(runLogs.runId, [...seededRunIds]));
    await db.delete(runArchives).where(inArray(runArchives.id, [...seededRunIds]));
    seededRunIds.clear();
  }
});

afterAll(async () => {
  await redis.quit();
});

describe("VS-6: GET /api/admin/runs/:runId/observability surfaces new log events", () => {
  it("returns 200 with all seeded events in logs[] and error rows in failures[]", async () => {
    const runId = randomUUID();
    await db.insert(runArchives).values({
      tenantId: TENANT_ZERO_ID,
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: true,
      completedAt: new Date("2099-07-01T00:10:00Z"),
      startedAt: new Date("2099-07-01T00:00:00Z"),
      sourceTypes: ["blog"],
    });
    seededRunIds.add(runId);

    await db.insert(runLogs).values([
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "info",
        stage: "collect",
        source: "blog",
        event: "collector.web.listing_completed",
        message: "listing completed",
        context: { listingUrl: "https://cursor.com/blog", discovered: 12 },
      },
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "warn",
        stage: "collect",
        source: "blog",
        event: "collector.web.discovery_failed",
        message: "discovery failed",
        context: {
          listingUrl: "https://cursor.com/blog",
          error: "discovery boom",
          step: "discovery",
        },
      },
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "info",
        stage: "collect",
        source: "blog",
        event: "web.extract.start",
        message: "extract start",
        context: { url: "https://cursor.com/blog/post-1" },
      },
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "error",
        stage: "collect",
        source: "blog",
        event: "web.extract.failed",
        message: "extract failed",
        context: {
          url: "https://cursor.com/blog/post-1",
          error: "boom",
          step: "extract",
        },
      },
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "info",
        stage: "collect",
        source: "blog",
        event: "crawler.stats",
        message: "crawler stats",
        context: { jobs: 1, requestsFinished: 3, requestsFailed: 0 },
      },
      {
        tenantId: TENANT_ZERO_ID,
        runId,
        level: "error",
        stage: "enrich",
        source: "blog",
        event: "link_enrichment.failed",
        message: "enrich failed",
        context: {
          url: "https://example.com/link",
          failureReason: "timeout",
          step: "enrich",
        },
      },
    ]);

    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/observability`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    interface LogRow {
      event: string;
      level: string;
      context: Record<string, unknown> | null;
    }
    const body = (await res.json()) as {
      live: boolean;
      logs: LogRow[];
      failures: LogRow[];
    };

    expect(body.live).toBe(false);

    const eventsSeen = new Set(body.logs.map((row) => row.event));
    expect(eventsSeen.has("collector.web.listing_completed")).toBe(true);
    expect(eventsSeen.has("collector.web.discovery_failed")).toBe(true);
    expect(eventsSeen.has("web.extract.start")).toBe(true);
    expect(eventsSeen.has("web.extract.failed")).toBe(true);
    expect(eventsSeen.has("crawler.stats")).toBe(true);
    expect(eventsSeen.has("link_enrichment.failed")).toBe(true);
    expect(body.logs.length).toBeGreaterThanOrEqual(6);

    expect(body.failures.length).toBe(2);
    const failureEvents = body.failures.map((row) => row.event).sort();
    expect(failureEvents).toEqual(["link_enrichment.failed", "web.extract.failed"]);

    for (const failure of body.failures) {
      expect(failure.level).toBe("error");
      expect(failure.context).not.toBeNull();
      const ctx = failure.context;
      if (ctx === null) throw new Error("unreachable");
      expect(typeof ctx.url).toBe("string");
      expect(typeof ctx.step).toBe("string");
    }
  });
});

describe("VS-7: GET /api/admin/runs/:runId/sources/blog:cursor.com/items returns matching items", () => {
  it("returns 200 with the three seeded items after the identifier alignment fix", async () => {
    const runId = randomUUID();

    const blogTelemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "blog",
          identifier: "cursor.com",
          displayName: "Cursor",
          itemsFetched: 3,
          status: "completed",
          errors: [],
          retries: 0,
          durationMs: 100,
        },
      ],
      totalItemsFetched: 3,
      totalErrors: 0,
    };

    await db.insert(runArchives).values({
      tenantId: TENANT_ZERO_ID,
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: true,
      completedAt: new Date("2099-07-02T00:10:00Z"),
      startedAt: new Date("2099-07-02T00:00:00Z"),
      sourceTypes: ["blog"],
      sourceTelemetry: blogTelemetry,
    });
    seededRunIds.add(runId);

    const urls = [
      "https://cursor.com/blog/post-1",
      "https://cursor.com/blog/post-2",
      "https://cursor.com/blog/post-3",
    ];
    for (const [idx, url] of urls.entries()) {
      const [row] = await db
        .insert(rawItems)
        .values({
          tenantId: TENANT_ZERO_ID,
          tenantId: TENANT_ZERO_ID,
          runId,
          sourceType: "blog",
          externalId: `cursor-${idx}-${randomUUID()}`,
          title: `Cursor post ${idx + 1}`,
          url,
          sourceUrl: "https://cursor.com/blog",
          author: "Cursor",
          publishedAt: new Date("2099-07-02T00:05:00Z"),
          collectedAt: new Date("2099-07-02T00:06:00Z"),
          engagement: { points: 0, commentCount: 0 },
          metadata: {
            comments: [],
            enrichedLink: {
              url,
              fetchedAt: "2099-07-02T00:07:00Z",
              status: "ok",
              title: `Cursor post ${idx + 1}`,
            },
          },
        })
        .returning({ id: rawItems.id });
      seededRawItemIds.add(row.id);
    }

    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/sources/${encodeURIComponent("blog:cursor.com")}/items`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: number; sourceIdentifier: string }[];
      summary: { dedupedSurvivors: number };
    };

    expect(body.items).toHaveLength(3);
    for (const item of body.items) {
      expect(item.sourceIdentifier).toBe("cursor.com");
    }
    expect(body.summary.dedupedSurvivors).toBe(3);
  });
});

describe("VS-8: legacy archive with listing-URL identifier returns 200 + empty items", () => {
  it("does not crash for legacy archives whose telemetry identifier is the full URL", async () => {
    const runId = randomUUID();

    const legacyTelemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "blog",
          identifier: "https://cursor.com/blog",
          displayName: "Cursor",
          itemsFetched: 0,
          status: "completed",
          errors: [],
          retries: 0,
          durationMs: 100,
        },
      ],
      totalItemsFetched: 0,
      totalErrors: 0,
    };

    await db.insert(runArchives).values({
      tenantId: TENANT_ZERO_ID,
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: true,
      completedAt: new Date("2099-07-03T00:10:00Z"),
      startedAt: new Date("2099-07-03T00:00:00Z"),
      sourceTypes: ["blog"],
      sourceTelemetry: legacyTelemetry,
    });
    seededRunIds.add(runId);

    const legacyKey = encodeURIComponent("blog:https://cursor.com/blog");
    const res = await buildGatedApp().request(
      `/api/admin/runs/${runId}/sources/${legacyKey}/items`,
      { headers: { cookie: adminCookie() } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: readonly unknown[];
      summary: { dedupedSurvivors: number };
    };
    expect(body.items).toHaveLength(0);
    expect(body.summary.dedupedSurvivors).toBe(0);
  });
});
