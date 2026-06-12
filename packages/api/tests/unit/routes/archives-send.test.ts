import { describe, it, expect, vi } from "vitest";
import { setTestTenant, TEST_TENANT_ID } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type { RankedItemRef } from "@newsletter/shared";
import { createAdminArchivesRouter } from "@api/routes/archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchiveRow, RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { Queue } from "bullmq";

const date = new Date("2026-04-10T00:00:00Z");

function makeArchiveRow(refs: RankedItemRef[] = []): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: refs,
    topN: 5,
    reviewed: false,
    completedAt: date,
    createdAt: date,
    startedAt: null,
    sourceTypes: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: {},
  };
}

function makeArchiveRepo(row: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.resolve(row as RunArchiveRow)),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  };
}

function makeRawRepo(ids: number[] = []): RawItemsRepo {
  return {
    findByIds: vi.fn((reqIds: number[]) => {
      return Promise.resolve(
        reqIds
          .filter((id) => ids.includes(id))
          .map((id) => ({
            id,
            sourceType: "hn" as const,
            title: `t${id}`,
            url: `https://example.com/${id}`,
            author: null,
            publishedAt: null,
            engagement: { points: 0, commentCount: 0 },
            content: null,
            imageUrl: null,
            metadata: { comments: [] },
          })),
      );
    }),
  };
}

function makeProcessingQueue(): {
  queue: Pick<Queue, "add">;
  addSpy: ReturnType<typeof vi.fn>;
} {
  const addSpy = vi.fn(() => Promise.resolve({ id: "job-1" }));
  const queue = {
    add: addSpy,
  } as Pick<Queue, "add">;
  return { queue, addSpy };
}

function buildApp(opts: {
  archiveRepo: RunArchivesRepo;
  rawRepo?: RawItemsRepo;
  processingQueue?: Pick<Queue, "add">;
}): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  const router = createAdminArchivesRouter({
    getArchiveRepo: () => opts.archiveRepo,
    getRawItemsRepo: () => opts.rawRepo ?? makeRawRepo(),
    processingQueue: opts.processingQueue ?? makeProcessingQueue().queue,
  });
  app.route("/api/admin/archives", router);
  return app;
}

// The "PATCH saves a reviewed archive without scheduling publish jobs" test was
// removed: PATCH-with-no-past-due-channels → no-enqueue is covered by
// archives-route.test.ts and the immediate-publish suite
// (archives-immediate-publish.test.ts). This file scopes to the /send route.

describe("POST /api/admin/archives/:runId/send", () => {
  it("REQ-010: returns 202 and enqueues email-send job", async () => {
    const archiveRow = makeArchiveRow();
    const archiveRepo = makeArchiveRepo(archiveRow);
    const { queue, addSpy } = makeProcessingQueue();
    const app = buildApp({ archiveRepo, processingQueue: queue });

    const res = await app.request("/api/admin/archives/run-1/send", {
      method: "POST",
    });

    expect(res.status).toBe(202);
    expect(addSpy).toHaveBeenCalledWith(
      "email-send",
      { runId: "run-1", tenantId: TEST_TENANT_ID },
      { jobId: "email-send-run-1", delay: 0 },
    );
  });

  it("returns 404 when archive does not exist", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const { queue } = makeProcessingQueue();
    const app = buildApp({ archiveRepo, processingQueue: queue });

    const res = await app.request("/api/admin/archives/missing/send", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
