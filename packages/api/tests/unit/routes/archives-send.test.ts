import { describe, it, expect, vi } from "vitest";
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
  const router = createAdminArchivesRouter({
    getArchiveRepo: () => opts.archiveRepo,
    getRawItemsRepo: () => opts.rawRepo ?? makeRawRepo(),
    processingQueue: opts.processingQueue ?? makeProcessingQueue().queue,
  });
  app.route("/api/admin/archives", router);
  return app;
}

describe("PATCH /api/admin/archives/:runId", () => {
  it("saves a reviewed archive without scheduling per-archive publish jobs", async () => {
    const archiveRow = makeArchiveRow([{ rawItemId: 1, score: 0.9, rationale: "" }]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const { queue, addSpy } = makeProcessingQueue();
    const app = buildApp({
      archiveRepo,
      rawRepo: makeRawRepo([1]),
      processingQueue: queue,
    });

    const res = await app.request("/api/admin/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [{ id: 1, sourceType: "hn" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(addSpy).not.toHaveBeenCalled();
  });
});

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
      { runId: "run-1" },
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
