import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type {
  RunState,
  PoolResponse,
  RankedItem,
  SlackNotifier,
} from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";
import type { GenerateRecapFn } from "@api/services/review.js";
import type { Queue } from "bullmq";
import type { NewsletterSendJobPayload } from "@newsletter/shared";

function makeRepo(rows: RawItemRow[] = []): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id))),
    ),
  };
}

function makeArchiveRepo(
  row: RunArchiveRow | null,
  poolResult?: PoolResponse,
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.resolve(row as RunArchiveRow)),
    findPoolItems: vi.fn(() =>
      Promise.resolve(poolResult ?? { items: [], total: 0 }),
    ),
    markSlackNotified: vi.fn(() => Promise.resolve()),
  };
}

function makeApp(opts: {
  repo?: RawItemsRepo;
  archiveRepo: RunArchivesRepo;
  generateRecapFn?: GenerateRecapFn;
  slackNotifier?: SlackNotifier;
  sendQueue?: Queue<NewsletterSendJobPayload>;
}): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
    getArchiveRepo: () => opts.archiveRepo,
    generateRecapFn: opts.generateRecapFn,
    slackNotifier: opts.slackNotifier,
    sendQueue: opts.sendQueue,
  });
  app.route("/api/archives", router);
  return app;
}

describe("GET /api/archives/:runId", () => {
  it("returns hydrated RunState from PostgreSQL for a completed archive", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "archived-run",
      status: "completed",
      rankedItems: [{ rawItemId: 42, score: 0.85, rationale: "relevant" }],
      topN: 5,
      reviewed: false,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
    });
    const repo = makeRepo([
      {
        id: 42,
        sourceType: "hn",
        title: "Archived Article",
        url: "https://example.com/archived",
        author: "bob",
        publishedAt: new Date("2026-04-11T00:00:00Z"),
        engagement: { points: 100, commentCount: 10 },
        content: null,
        imageUrl: "https://example.com/img.png",
        metadata: { comments: [] },
      },
    ]);
    const app = makeApp({ repo, archiveRepo });
    const res = await app.request("/api/archives/archived-run");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState & { rankedItems: { id: number; title: string; score: number }[] };
    expect(body.status).toBe("completed");
    expect(body.stage).toBe("completed");
    expect(body.topN).toBe(5);
    expect(body.completedAt).toBe(completedAt.toISOString());
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0]).toMatchObject({
      id: 42,
      title: "Archived Article",
      score: 0.85,
    });
  });

  it("returns 404 when archive not found in PostgreSQL", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "not found" });
  });

  it("returns valid RunState with empty rankedItems array", async () => {
    const completedAt = new Date("2026-04-12T12:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "empty-archive",
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: false,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/empty-archive");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState;
    expect(body.status).toBe("completed");
    expect(body.rankedItems).toEqual([]);
  });

  it("returns status from the archive row", async () => {
    const completedAt = new Date("2026-04-12T12:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "failed-run",
      status: "failed",
      rankedItems: [],
      topN: 10,
      reviewed: false,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/failed-run");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState;
    expect(body.status).toBe("failed");
    expect(body.stage).toBe("failed");
  });

  it("hydrates items and filters out missing raw_items", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "partial-archive",
      status: "completed",
      rankedItems: [
        { rawItemId: 1, score: 0.9, rationale: "top" },
        { rawItemId: 999, score: 0.5, rationale: "gone" },
      ],
      topN: 5,
      completedAt,
      createdAt: completedAt,
      reviewed: false,
      startedAt: null,
      sourceTypes: null,
    });
    const repo = makeRepo([
      {
        id: 1,
        sourceType: "hn",
        title: "Exists",
        url: "https://example.com",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const app = makeApp({ repo, archiveRepo });
    const res = await app.request("/api/archives/partial-archive");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rankedItems: { id: number }[] };
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0].id).toBe(1);
  });
});

describe("GET /api/archives/:runId/pool (REQ-013, REQ-014, REQ-015, REQ-016, EDGE-006, EDGE-010)", () => {
  const startedAt = new Date("2026-04-10T00:00:00Z");

  it("returns 404 for unknown runId", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/nonexistent/pool");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found");
  });

  it("returns pool items for a valid runId (REQ-013)", async () => {
    const poolResult: PoolResponse = {
      items: [
        {
          id: 5,
          title: "Pool Item",
          url: "https://example.com/pool",
          sourceType: "hn",
          author: "alice",
          publishedAt: "2026-04-10T12:00:00.000Z",
          engagement: { points: 50, commentCount: 3 },
          imageUrl: null,
        },
      ],
      total: 1,
    };
    const archiveRepo = makeArchiveRepo(
      {
        id: "run-1",
        status: "completed",
        rankedItems: [{ rawItemId: 42, score: 0.9, rationale: "" }],
        topN: 5,
        reviewed: false,
        completedAt: startedAt,
        createdAt: startedAt,
        startedAt,
        sourceTypes: ["hn"],
      },
      poolResult,
    );
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/pool");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PoolResponse;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(5);
  });

  it("EDGE-006: returns empty pool for legacy run (null startedAt)", async () => {
    const archiveRepo = makeArchiveRepo({
      id: "legacy-run",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt: startedAt,
      createdAt: startedAt,
      startedAt: null,
      sourceTypes: null,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/legacy-run/pool");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PoolResponse;
    expect(body).toEqual({ items: [], total: 0 });
  });

  it("passes sort, source, q, offset, limit query params through (REQ-014, REQ-015, REQ-016)", async () => {
    const archiveRepo = makeArchiveRepo(
      {
        id: "run-1",
        status: "completed",
        rankedItems: [],
        topN: 5,
        reviewed: false,
        completedAt: startedAt,
        createdAt: startedAt,
        startedAt,
        sourceTypes: ["hn", "reddit"],
      },
    );
    const app = makeApp({ archiveRepo });
    const res = await app.request(
      "/api/archives/run-1/pool?sort=recency&source=hn&q=llama&offset=20&limit=10",
    );
    expect(res.status).toBe(200);
    expect(archiveRepo.findPoolItems).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        sort: "recency",
        source: "hn",
        q: "llama",
        offset: 20,
        limit: 10,
      }),
    );
  });

  it("EDGE-010: returns empty items with total for offset beyond total", async () => {
    const poolResult: PoolResponse = { items: [], total: 5 };
    const archiveRepo = makeArchiveRepo(
      {
        id: "run-1",
        status: "completed",
        rankedItems: [],
        topN: 5,
        reviewed: false,
        completedAt: startedAt,
        createdAt: startedAt,
        startedAt,
        sourceTypes: ["hn"],
      },
      poolResult,
    );
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/pool?offset=100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PoolResponse;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(5);
  });

  it("clamps limit to 100 max", async () => {
    const archiveRepo = makeArchiveRepo(
      {
        id: "run-1",
        status: "completed",
        rankedItems: [],
        topN: 5,
        reviewed: false,
        completedAt: startedAt,
        createdAt: startedAt,
        startedAt,
        sourceTypes: ["hn"],
      },
    );
    const app = makeApp({ archiveRepo });
    await app.request("/api/archives/run-1/pool?limit=500");
    expect(archiveRepo.findPoolItems).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ limit: 100 }),
    );
  });
});

describe("POST /api/archives/:runId/promote (REQ-010, REQ-011, EDGE-007)", () => {
  const startedAt = new Date("2026-04-10T00:00:00Z");

  function makeRawRow(id: number): RawItemRow {
    return {
      id,
      sourceType: "hn",
      title: "Promotable Item",
      url: `https://example.com/item-${id}`,
      author: "bob",
      publishedAt: new Date("2026-04-10T12:00:00Z"),
      engagement: { points: 100, commentCount: 5 },
      content: "some content",
      imageUrl: null,
      metadata: { comments: [] },
    };
  }

  it("REQ-011: returns 404 for missing rawItemId", async () => {
    const archiveRepo = makeArchiveRepo({
      id: "run-1",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt: startedAt,
      createdAt: startedAt,
      startedAt,
      sourceTypes: ["hn"],
    });
    const generateRecapFn = vi.fn();
    const app = makeApp({ archiveRepo, repo: makeRepo([]), generateRecapFn });
    const res = await app.request("/api/archives/run-1/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawItemId: 999 }),
    });
    expect(res.status).toBe(404);
  });

  it("REQ-011/EDGE-007: returns 409 for already-ranked rawItemId", async () => {
    const archiveRepo = makeArchiveRepo({
      id: "run-1",
      status: "completed",
      rankedItems: [{ rawItemId: 10, score: 0.9, rationale: "" }],
      topN: 5,
      reviewed: false,
      completedAt: startedAt,
      createdAt: startedAt,
      startedAt,
      sourceTypes: ["hn"],
    });
    const generateRecapFn = vi.fn();
    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawRow(10)]),
      generateRecapFn,
    });
    const res = await app.request("/api/archives/run-1/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawItemId: 10 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Item is already in the ranked list");
  });

  it("REQ-010: returns hydrated RankedItem with recap on success", async () => {
    const recap = {
      summary: "A summary",
      bullets: ["b1", "b2"],
      bottomLine: "The bottom line",
    };
    const generateRecapFn = vi.fn().mockResolvedValue(recap);
    const rawRow = makeRawRow(10);
    const archiveRepo = makeArchiveRepo({
      id: "run-1",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt: startedAt,
      createdAt: startedAt,
      startedAt,
      sourceTypes: ["hn"],
    });
    const app = makeApp({
      archiveRepo,
      repo: makeRepo([rawRow]),
      generateRecapFn,
    });
    const res = await app.request("/api/archives/run-1/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawItemId: 10 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankedItem;
    expect(body.id).toBe(10);
    expect(body.rawItemId).toBe(10);
    expect(body.title).toBe("Promotable Item");
    expect(body.score).toBe(0);
    expect(body.recap).toEqual(recap);
    expect(generateRecapFn).toHaveBeenCalledOnce();
  });

  it("returns 404 for missing archive", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const generateRecapFn = vi.fn();
    const app = makeApp({ archiveRepo, generateRecapFn });
    const res = await app.request("/api/archives/nonexistent/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawItemId: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid body", async () => {
    const archiveRepo = makeArchiveRepo({
      id: "run-1",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt: startedAt,
      createdAt: startedAt,
      startedAt,
      sourceTypes: ["hn"],
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawItemId: "not-a-number" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/archives/:runId Slack notification (P5)", () => {
  const date = new Date("2026-04-10T00:00:00Z");

  function makeRow(): RunArchiveRow {
    return {
      id: "run-1",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt: date,
      createdAt: date,
      startedAt: null,
      sourceTypes: null,
    };
  }

  function makeUpdatedRow(): RunArchiveRow {
    return {
      ...makeRow(),
      rankedItems: [{ rawItemId: 1, score: 0, rationale: "" }],
      reviewed: true,
    };
  }

  function makeRawForId(id: number): RawItemRow {
    return {
      id,
      sourceType: "hn",
      title: `t${id}`,
      url: `https://example.com/${id}`,
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      imageUrl: null,
      metadata: { comments: [] },
    };
  }

  function patchBody(): string {
    return JSON.stringify({ rankedItems: [{ id: 1, sourceType: "hn" }] });
  }

  function makeSendQueue(): Queue<NewsletterSendJobPayload> & {
    add: ReturnType<typeof vi.fn>;
  } {
    const add = vi.fn().mockResolvedValue({ id: "job-1" });
    return { add } as unknown as Queue<NewsletterSendJobPayload> & {
      add: ReturnType<typeof vi.fn>;
    };
  }

  it("VS-1: invokes slackNotifier.notifyReviewedArchive once with manual trigger after sendQueue.add", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    archiveRepo.updateRankedItems = vi.fn(() => Promise.resolve(makeUpdatedRow()));
    const sendQueue = makeSendQueue();
    const notify = vi.fn().mockResolvedValue(undefined);
    const slackNotifier: SlackNotifier = { notifyReviewedArchive: notify };

    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawForId(1)]),
      slackNotifier,
      sendQueue,
    });

    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: patchBody(),
    });

    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ runId: "run-1", trigger: "manual" });

    // Order: sendQueue.add invoked before slack notifier
    const sendOrder = sendQueue.add.mock.invocationCallOrder[0];
    const notifyOrder = notify.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(notifyOrder);
  });

  it("VS-3: route always invokes notifier (idempotency lives in the notifier itself)", async () => {
    const archiveRepo = makeArchiveRepo({
      ...makeRow(),
      reviewed: true,
    });
    archiveRepo.updateRankedItems = vi.fn(() => Promise.resolve(makeUpdatedRow()));
    const notify = vi.fn().mockResolvedValue(undefined);
    const slackNotifier: SlackNotifier = { notifyReviewedArchive: notify };

    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawForId(1)]),
      slackNotifier,
    });

    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: patchBody(),
    });

    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("VS-7: returns 200 even when notifier rejects unexpectedly", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    archiveRepo.updateRankedItems = vi.fn(() => Promise.resolve(makeUpdatedRow()));
    const notify = vi.fn().mockRejectedValue(new Error("network blew up"));
    const slackNotifier: SlackNotifier = { notifyReviewedArchive: notify };

    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawForId(1)]),
      slackNotifier,
    });

    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: patchBody(),
    });

    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("works without a configured notifier (deps.slackNotifier undefined)", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    archiveRepo.updateRankedItems = vi.fn(() => Promise.resolve(makeUpdatedRow()));

    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawForId(1)]),
    });

    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: patchBody(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviewed: boolean };
    expect(body.reviewed).toBe(true);
  });
});
