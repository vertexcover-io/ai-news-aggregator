import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { RankedItem, RankedItemRef } from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import type { GenerateDigestFn } from "@api/services/review.js";

const date = new Date("2026-04-10T00:00:00Z");

function makeArchiveRow(refs: RankedItemRef[]): RunArchiveRow {
  return {
    id: "run-1",
    status: "completed",
    rankedItems: refs,
    topN: 5,
    reviewed: false,
    completedAt: date,
    createdAt: date,
  };
}

function makeArchiveRepo(
  row: RunArchiveRow | null,
  updated?: RunArchiveRow,
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() =>
      Promise.resolve(updated ?? (row as RunArchiveRow)),
    ),
  };
}

function makeRawRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id))),
    ),
  };
}

function rawRow(id: number, url = `https://example.com/${id}`): RawItemRow {
  return {
    id,
    sourceType: "hn",
    title: `t${id}`,
    url,
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    content: null,
    imageUrl: null,
    metadata: { comments: [] },
  };
}

interface MakeAppOpts {
  archiveRepo: RunArchivesRepo;
  rawRepo?: RawItemsRepo;
  hydrateAddedPost?: ReturnType<typeof vi.fn>;
  generateDigestFn?: GenerateDigestFn;
}

function makeApp(opts: MakeAppOpts): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getArchiveRepo: () => opts.archiveRepo,
    getRawItemsRepo: () => opts.rawRepo ?? makeRawRepo([]),
    hydrateAddedPost: opts.hydrateAddedPost ?? vi.fn(),
    generateDigestFn:
      opts.generateDigestFn ??
      (() => Promise.resolve({ headline: "Generated", summary: "Generated summary" })),
  });
  app.route("/api/archives", router);
  return app;
}

describe("PATCH /api/archives/:runId", () => {
  it("REQ-160: returns 200 with the updated archive row", async () => {
    const archiveRow = makeArchiveRow([]);
    const updated: RunArchiveRow = {
      ...archiveRow,
      rankedItems: [{ rawItemId: 1, score: 0, rationale: "" }],
      reviewed: true,
    };
    const archiveRepo = makeArchiveRepo(archiveRow, updated);
    const app = makeApp({
      archiveRepo,
      rawRepo: makeRawRepo([rawRow(1)]),
    });
    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [{ id: 1, sourceType: "hn" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviewed: boolean };
    expect(body.reviewed).toBe(true);
  });

  it("REQ-162: returns 400 for an empty list", async () => {
    const app = makeApp({ archiveRepo: makeArchiveRepo(makeArchiveRow([])) });
    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rankedItems: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("EDGE-110: returns 400 for duplicate ids", async () => {
    const app = makeApp({ archiveRepo: makeArchiveRepo(makeArchiveRow([])) });
    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [
          { id: 1, sourceType: "hn" },
          { id: 1, sourceType: "hn" },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-161: returns 400 with missingIds when raw_items are missing", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const app = makeApp({ archiveRepo, rawRepo: makeRawRepo([]) });
    const res = await app.request("/api/archives/run-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [
          { id: 1, sourceType: "hn" },
          { id: 2, sourceType: "hn" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missingIds: number[] };
    expect(body.missingIds.sort()).toEqual([1, 2]);
  });

  it("REQ-163: returns 404 when archive does not exist", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankedItems: [{ id: 1, sourceType: "hn" }],
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/archives/:runId/add-post", () => {
  function makeRanked(): RankedItem {
    return {
      id: 42,
      rawItemId: 42,
      title: "Added",
      url: "https://example.com/added",
      sourceType: "web",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      score: 0,
      rationale: "Added manually during review",
      content: null,
      imageUrl: null,
      recap: null,
    };
  }

  it("REQ-140 happy: returns 200 with the hydrated RankedItem", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const ranked = makeRanked();
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const app = makeApp({ archiveRepo, hydrateAddedPost: hydrate });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ranked.url }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RankedItem;
    expect(body.url).toBe(ranked.url);
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it("REQ-024: returns 400 when body is empty {}", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-024: returns 400 when url is empty string", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-144: returns 400 for malformed URL", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const app = makeApp({ archiveRepo });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  it("EDGE-022/EDGE-036: ignores extra sourceType field in body, uses detected source type from URL", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const ranked = makeRanked();
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const app = makeApp({ archiveRepo, hydrateAddedPost: hydrate });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", sourceType: "hn" }),
    });
    expect(res.status).toBe(200);
    // sourceType in body is ignored; URL is a generic web URL → detected as "web"
    expect(hydrate).toHaveBeenCalledOnce();
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("web");
  });

  // REQ-005: HN URL is now detected as "hn" (source-aware detection)
  it("REQ-005: HN URL is detected and passed to hydrateAddedPost as 'hn'", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const ranked = makeRanked();
    const hydrate = vi.fn().mockResolvedValue(ranked);
    const app = makeApp({ archiveRepo, hydrateAddedPost: hydrate });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://news.ycombinator.com/item?id=1",
      }),
    });
    expect(res.status).toBe(200);
    expect(hydrate).toHaveBeenCalledOnce();
    const [, calledSourceType] = hydrate.mock.calls[0] as [string, string];
    expect(calledSourceType).toBe("hn");
  });

  it("REQ-146: returns 409 when URL already in archive", async () => {
    const url = "https://example.com/dupe";
    const existing: RawItemRow = {
      ...rawRow(7),
      url,
    };
    const archiveRow = makeArchiveRow([
      { rawItemId: 7, score: 0.5, rationale: "" },
    ]);
    const archiveRepo = makeArchiveRepo(archiveRow);
    const app = makeApp({
      archiveRepo,
      rawRepo: makeRawRepo([existing]),
      hydrateAddedPost: vi.fn(),
    });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(409);
  });

  it("REQ-145: returns 502 when upstream hydration fails", async () => {
    const archiveRepo = makeArchiveRepo(makeArchiveRow([]));
    const hydrate = vi.fn().mockRejectedValue(new Error("upstream fetch 503"));
    const app = makeApp({ archiveRepo, hydrateAddedPost: hydrate });
    const res = await app.request("/api/archives/run-1/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://news.ycombinator.com/item?id=1" }),
    });
    expect(res.status).toBe(502);
  });

  it("REQ-163: returns 404 when archive does not exist", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeApp({ archiveRepo, hydrateAddedPost: vi.fn() });
    const res = await app.request("/api/archives/missing/add-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(404);
  });
});
