import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { RunState, PoolResponse, RankedItem } from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";
import type { GenerateRecapFn } from "@api/services/review.js";

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
  };
}

function makeApp(opts: {
  repo?: RawItemsRepo;
  archiveRepo: RunArchivesRepo;
  generateRecapFn?: GenerateRecapFn;
}): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
    getArchiveRepo: () => opts.archiveRepo,
    generateRecapFn: opts.generateRecapFn,
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
