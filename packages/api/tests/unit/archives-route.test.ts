import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type {
  RunState,
  PoolResponse,
  RankedItem,
  ArchiveListItem,
  ArchiveListResponse,
} from "@newsletter/shared";
import {
  createArchivesRouter,
  createAdminArchivesRouter,
  createPublicArchivesRouter,
} from "@api/routes/archives.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { GenerateRecapFn } from "@api/services/review.js";
import type { GenerateDigestMetaFn } from "@api/services/review.js";
import type { DigestMeta } from "@newsletter/shared/constants";
import type { Queue } from "bullmq";

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

function makeSettingsRepo(timezone: string): Pick<UserSettingsRepo, "get"> {
  return {
    get: vi.fn(() =>
      Promise.resolve({
        scheduleTimezone: timezone,
      } as Awaited<ReturnType<UserSettingsRepo["get"]>>),
    ),
  };
}

function makeApp(opts: {
  repo?: RawItemsRepo;
  archiveRepo: RunArchivesRepo;
  generateRecapFn?: GenerateRecapFn;
  generateDigestMeta?: GenerateDigestMetaFn;
  processingQueue?: Pick<Queue, "add">;
  settingsRepo?: Pick<UserSettingsRepo, "get">;
}): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
    getArchiveRepo: () => opts.archiveRepo,
    generateRecapFn: opts.generateRecapFn,
    generateDigestMeta: opts.generateDigestMeta,
    processingQueue: opts.processingQueue,
    ...(opts.settingsRepo === undefined
      ? {}
      : { getSettingsRepo: () => opts.settingsRepo }),
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
      reviewed: true,
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

  it("REQ-002: returns issueDate in the admin settings timezone", async () => {
    const completedAt = new Date("2026-05-22T19:47:55.923Z");
    const archiveRepo = makeArchiveRepo({
      id: "near-midnight-archive",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: true,
      completedAt,
      createdAt: completedAt,
      startedAt: new Date("2026-05-22T19:44:00.000Z"),
      sourceTypes: null,
      isDryRun: false,
    });
    const app = makeApp({
      archiveRepo,
      settingsRepo: makeSettingsRepo("Asia/Kolkata"),
    });
    const res = await app.request("/api/archives/near-midnight-archive");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState & { issueDate?: string };
    expect(body.startedAt).toBe("2026-05-22T19:44:00.000Z");
    expect(body.issueDate).toBe("2026-05-23");
  });

  it("returns 404 when archive not found in PostgreSQL", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "not found" });
  });

  it("REQ-001: returns 200 with the archive body for a reviewed dry-run archive (now publicly viewable by direct link)", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "dry-run-archive",
      status: "completed",
      rankedItems: [{ rawItemId: 42, score: 0.85, rationale: "x" }],
      topN: 5,
      reviewed: true,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
      isDryRun: true,
    });
    const repo = makeRepo([
      {
        id: 42,
        sourceType: "hn",
        title: "Dry Run Article",
        url: "https://example.com/dry",
        author: null,
        publishedAt: null,
        engagement: { points: 0, commentCount: 0 },
        content: null,
        imageUrl: null,
        metadata: { comments: [] },
      },
    ]);
    const app = makeApp({ repo, archiveRepo });
    const res = await app.request("/api/archives/dry-run-archive");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunState & {
      rankedItems: { id: number }[];
    };
    expect(body.id).toBe("dry-run-archive");
    expect(body.status).toBe("completed");
    expect(body.rankedItems).toHaveLength(1);
    expect(body.rankedItems[0].id).toBe(42);
  });

  it("REQ-002/EDGE-005: returns 404 { error: 'not found' } for an un-reviewed dry-run archive", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "unreviewed-dry-run",
      status: "completed",
      rankedItems: [{ rawItemId: 42, score: 0.85, rationale: "x" }],
      topN: 5,
      reviewed: false,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
      isDryRun: true,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/unreviewed-dry-run");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "not found" });
  });

  it("EDGE-005: returns 404 { error: 'not found' } for an un-reviewed live archive (reviewed gate applies to all)", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "unreviewed-live",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: false,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
      isDryRun: false,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/unreviewed-live");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "not found" });
  });

  it("Phase 5: admin GET /api/admin/archives/:runId returns 200 for a dry-run archive (bypasses public 404 guard)", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "dry-run-archive",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: true,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
      isDryRun: true,
    } as unknown as RunArchiveRow);
    const app = new Hono();
    const adminRouter = createAdminArchivesRouter({
      getRawItemsRepo: () => makeRepo(),
      getArchiveRepo: () => archiveRepo,
    });
    app.route("/api/admin/archives", adminRouter);
    const res = await app.request("/api/admin/archives/dry-run-archive");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; isDryRun: boolean };
    expect(body.status).toBe("completed");
    expect(body.isDryRun).toBe(true);
  });

  it("Phase 5: admin GET /api/admin/archives/:runId returns 404 when archive not found", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = new Hono();
    const adminRouter = createAdminArchivesRouter({
      getRawItemsRepo: () => makeRepo(),
      getArchiveRepo: () => archiveRepo,
    });
    app.route("/api/admin/archives", adminRouter);
    const res = await app.request("/api/admin/archives/missing");
    expect(res.status).toBe(404);
  });

  it("R-14: returns 200 for a live archive with the same shape (regression)", async () => {
    const completedAt = new Date("2026-04-12T10:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "live-archive",
      status: "completed",
      rankedItems: [],
      topN: 5,
      reviewed: true,
      completedAt,
      createdAt: completedAt,
      startedAt: null,
      sourceTypes: null,
      isDryRun: false,
    });
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/live-archive");
    expect(res.status).toBe(200);
  });

  it("returns valid RunState with empty rankedItems array", async () => {
    const completedAt = new Date("2026-04-12T12:00:00Z");
    const archiveRepo = makeArchiveRepo({
      id: "empty-archive",
      status: "completed",
      rankedItems: [],
      topN: 10,
      reviewed: true,
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
      reviewed: true,
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
      reviewed: true,
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

describe("GET /api/archives (listing)", () => {
  it("REQ-003/EDGE-003: surfaces exactly what listReviewed returns and never re-includes a dry run", async () => {
    const liveItem: ArchiveListItem = {
      runId: "live-archive",
      runDate: "2026-04-12",
      storyCount: 3,
      topItems: [],
      leadSummary: null,
      digestHeadline: "Live issue",
      digestSummary: null,
      isDryRun: false,
    };
    const archiveRepo = makeArchiveRepo(null);
    archiveRepo.listReviewed = vi.fn(() => Promise.resolve([liveItem]));
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives).toEqual([liveItem]);
    expect(body.archives.some((a) => a.isDryRun)).toBe(false);
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
      title: "Recap title",
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
    // AI-generated recap title takes precedence over source title
    expect(body.title).toBe("Recap title");
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

describe("PATCH /api/archives/:runId", () => {
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
      emailSentAt: null,
      linkedinPostedAt: null,
      twitterPostedAt: null,
      notificationState: {},
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

  function makeProcessingQueue(): Pick<Queue, "add"> & {
    add: ReturnType<typeof vi.fn>;
  } {
    const add = vi.fn().mockResolvedValue({ id: "job-1" });
    return { add } as Pick<Queue, "add"> & {
      add: ReturnType<typeof vi.fn>;
    };
  }

  it("PATCH saves the review without scheduling per-archive publish jobs", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    archiveRepo.updateRankedItems = vi.fn(() => Promise.resolve(makeUpdatedRow()));
    const processingQueue = makeProcessingQueue();

    const app = makeApp({
      archiveRepo,
      repo: makeRepo([makeRawForId(1)]),
      processingQueue,
    });

    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: patchBody(),
    });

    expect(res.status).toBe(200);
    expect(processingQueue.add).not.toHaveBeenCalled();
  });
});

describe("POST /api/archives/:runId/regenerate-digest-meta", () => {
  const date = new Date("2026-04-10T00:00:00Z");

  function makeRow(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
    return {
      id: "run-1",
      status: "completed",
      rankedItems: [
        { rawItemId: 1, score: 0, rationale: "" },
        { rawItemId: 2, score: 0, rationale: "" },
      ],
      topN: 5,
      reviewed: true,
      completedAt: date,
      createdAt: date,
      startedAt: null,
      sourceTypes: null,
      digestHeadline: "old headline",
      digestSummary: "old summary",
      hook: "old hook",
      emailSentAt: null,
      linkedinPostedAt: null,
      twitterPostedAt: null,
      notificationState: {},
      isDryRun: false,
      ...overrides,
    } as RunArchiveRow;
  }

  const sampleMeta: DigestMeta = {
    headline: "Fresh headline",
    summary: "Fresh summary",
    hook: "Fresh hook",
    twitterSummary: "Fresh twitter summary",
  };

  function body(items: { id: number; title: string; summary: string; bottomLine: string }[]): string {
    return JSON.stringify({ items });
  }

  it("REQ-005: returns 200 with four string fields and does NOT persist", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as DigestMeta;
    expect(json).toEqual(sampleMeta);
    expect(typeof json.headline).toBe("string");
    expect(typeof json.summary).toBe("string");
    expect(typeof json.hook).toBe("string");
    expect(typeof json.twitterSummary).toBe("string");
    // No persistence: updateRankedItems is the only write path on the repo
    expect(archiveRepo.updateRankedItems).not.toHaveBeenCalled();
  });

  it("REQ-006: returns 404 for a non-existent runId", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/missing/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(typeof json.error).toBe("string");
    expect(generateDigestMeta).not.toHaveBeenCalled();
  });

  it("REQ-007: returns 409 with a reason for a dry-run archive", async () => {
    const archiveRepo = makeArchiveRepo(makeRow({ isDryRun: true }));
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { reason: string };
    expect(typeof json.reason).toBe("string");
    expect(generateDigestMeta).not.toHaveBeenCalled();
  });

  it("REQ-008: returns 502 with an error when the LLM call rejects", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() =>
      Promise.reject(new Error("anthropic exploded")),
    );
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });

    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(typeof json.error).toBe("string");
    expect(json.error).toContain("anthropic exploded");
  });

  it("returns 400 for an empty items array", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([]),
    });

    expect(res.status).toBe(400);
    expect(generateDigestMeta).not.toHaveBeenCalled();
  });

  it("returns 400 when an item id is not in the archive's ranked set", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));
    const app = makeApp({ archiveRepo, generateDigestMeta });

    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 999, title: "T", summary: "S", bottomLine: "B" }]),
    });

    expect(res.status).toBe(400);
    expect(generateDigestMeta).not.toHaveBeenCalled();
  });

  it("EDGE-006: passes items to generateDigestMeta in body order with rank = index+1", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const captured: { rank: number; title: string; summary: string; bottomLine: string }[][] = [];
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn((items) => {
      captured.push(items);
      return Promise.resolve(sampleMeta);
    });
    const app = makeApp({ archiveRepo, generateDigestMeta });

    // body order is item 2 first, then item 1 — opposite of DB rankedItems order
    const res = await app.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([
        { id: 2, title: "Second", summary: "S2", bottomLine: "B2" },
        { id: 1, title: "First", summary: "S1", bottomLine: "B1" },
      ]),
    });

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([
      { rank: 1, title: "Second", summary: "S2", bottomLine: "B2" },
      { rank: 2, title: "First", summary: "S1", bottomLine: "B1" },
    ]);
  });

  it("REQ-009: route is registered on the admin router, not the public router", async () => {
    const archiveRepo = makeArchiveRepo(makeRow());
    const generateDigestMeta: GenerateDigestMetaFn = vi.fn(() => Promise.resolve(sampleMeta));

    const publicApp = new Hono();
    publicApp.route(
      "/api/archives",
      createPublicArchivesRouter({
        getRawItemsRepo: () => makeRepo(),
        getArchiveRepo: () => archiveRepo,
        generateDigestMeta,
      }),
    );
    const publicRes = await publicApp.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });
    expect(publicRes.status).toBe(404);
    expect(generateDigestMeta).not.toHaveBeenCalled();

    const adminApp = new Hono();
    adminApp.route(
      "/api/archives",
      createAdminArchivesRouter({
        getRawItemsRepo: () => makeRepo(),
        getArchiveRepo: () => archiveRepo,
        generateDigestMeta,
      }),
    );
    const adminRes = await adminApp.request("/api/archives/run-1/regenerate-digest-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body([{ id: 1, title: "T1", summary: "S1", bottomLine: "B1" }]),
    });
    expect(adminRes.status).toBe(200);
    expect(generateDigestMeta).toHaveBeenCalledTimes(1);
  });
});
