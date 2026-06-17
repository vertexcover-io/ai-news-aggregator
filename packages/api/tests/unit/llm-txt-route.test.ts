import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  createLlmTxtRouter,
  createLlmTxtArchiveRouter,
  type LlmTxtRouterDeps,
} from "@api/routes/llm-txt.js";
import type { RawItemRow, RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  RunArchivesRepo,
  RunArchiveRow,
} from "@api/repositories/run-archives.js";
import type { MustReadRepo } from "@api/repositories/must-read.js";
import type { MustReadPublicEntry } from "@api/repositories/must-read.js";
import type { LlmTxtCache } from "@api/services/llm-txt-cache.js";

function makeMemoryCache(): LlmTxtCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
}

const baseUrl = "https://news.example.com";

function rawItem(over: Partial<RawItemRow> & { id: number }): RawItemRow {
  return {
    sourceType: "hn",
    title: `Item ${over.id}`,
    url: `https://example.com/${over.id}`,
    sourceUrl: null,
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    content: null,
    imageUrl: null,
    metadata: { comments: [] },
    ...over,
  } as RawItemRow;
}

function makeRawRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn((ids: number[]) =>
      Promise.resolve(rows.filter((r) => ids.includes(r.id))),
    ),
  };
}

function archiveRow(over: Partial<RunArchiveRow> & { id: string }): RunArchiveRow {
  const completedAt = new Date("2026-06-17T10:00:00Z");
  return {
    status: "completed",
    rankedItems: [],
    topN: 5,
    reviewed: true,
    isDryRun: false,
    completedAt,
    publishedAt: completedAt,
    draftSavedAt: null,
    createdAt: completedAt,
    startedAt: null,
    sourceTypes: null,
    digestHeadline: "Today in AI",
    digestSummary: "A summary.",
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    costBreakdown: null,
    runFunnel: null,
    socialMetadata: null,
    shortlistedItemIds: null,
    preReviewSnapshot: null,
    ...over,
  };
}

function makeArchiveRepo(rows: RunArchiveRow[]): RunArchivesRepo {
  return {
    findById: vi.fn((id: string) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    ),
    list: vi.fn(() => Promise.resolve(rows)),
    listReviewedRows: vi.fn(() =>
      Promise.resolve(rows.filter((r) => r.reviewed && !r.isDryRun)),
    ),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
    markSlackNotified: vi.fn(() => Promise.resolve()),
  } as unknown as RunArchivesRepo;
}

function makeMustReadRepo(entries: MustReadPublicEntry[]): MustReadRepo {
  return {
    listPublic: vi.fn(() => Promise.resolve(entries)),
  } as unknown as MustReadRepo;
}

function canonEntry(id: string): MustReadPublicEntry {
  return {
    id,
    url: `https://essay.example/${id}`,
    title: `Essay ${id}`,
    author: "Author",
    year: 2020,
    annotation: "Read this.",
    addedAt: new Date("2026-01-01T00:00:00Z"),
  } as MustReadPublicEntry;
}

function deps(over: Partial<LlmTxtRouterDeps>): LlmTxtRouterDeps {
  return {
    getArchiveRepo: () => makeArchiveRepo([]),
    getRawItemsRepo: () => makeRawRepo([]),
    getMustReadRepo: () => makeMustReadRepo([]),
    baseUrl,
    ...over,
  };
}

describe("GET /llms.txt", () => {
  it("returns text/plain index with cache header and links", async () => {
    const rows = [archiveRow({ id: "run-1" })];
    const app = new Hono();
    app.route(
      "/",
      createLlmTxtRouter(
        deps({
          getArchiveRepo: () => makeArchiveRepo(rows),
          getMustReadRepo: () => makeMustReadRepo([canonEntry("a"), canonEntry("b")]),
        }),
      ),
    );
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    const body = await res.text();
    expect(body.startsWith("# ")).toBe(true);
    expect(body).toContain("## Issues");
    expect(body).toContain("## Canon");
    expect(body).toContain("https://news.example.com/archive/run-1");
    expect(body).toContain("[Essay a](https://essay.example/a)");
  });

  it("excludes unreviewed and dry-run archives from the index", async () => {
    const rows = [
      archiveRow({ id: "shown" }),
      archiveRow({ id: "hidden-unreviewed", reviewed: false }),
      archiveRow({ id: "hidden-dry", isDryRun: true }),
    ];
    const app = new Hono();
    app.route("/", createLlmTxtRouter(deps({ getArchiveRepo: () => makeArchiveRepo(rows) })));
    const body = await (await app.request("/llms.txt")).text();
    expect(body).toContain("/archive/shown");
    expect(body).not.toContain("hidden-unreviewed");
    expect(body).not.toContain("hidden-dry");
  });
});

describe("GET /llms-full.txt", () => {
  it("inlines issue story content", async () => {
    const rows = [
      archiveRow({
        id: "run-1",
        rankedItems: [{ rawItemId: 42, score: 0.9, rationale: "x" }],
      }),
    ];
    const raw = makeRawRepo([
      rawItem({
        id: 42,
        title: "Big Story",
        url: "https://example.com/big",
        metadata: {
          comments: [],
          recap: {
            title: "Big Story",
            summary: "Something happened.",
            bullets: ["a"],
            bottomLine: "Matters.",
          },
        } as RawItemRow["metadata"],
      }),
    ]);
    const app = new Hono();
    app.route(
      "/",
      createLlmTxtRouter(
        deps({
          getArchiveRepo: () => makeArchiveRepo(rows),
          getRawItemsRepo: () => raw,
        }),
      ),
    );
    const body = await (await app.request("/llms-full.txt")).text();
    expect(body).toContain("[Big Story](https://example.com/big)");
    expect(body).toContain("Something happened.");
  });
});

describe("GET /api/archives/:runId/llm.txt", () => {
  it("returns the issue text for a reviewed run", async () => {
    const rows = [archiveRow({ id: "run-1" })];
    const app = new Hono();
    app.route(
      "/api/archives",
      createLlmTxtArchiveRouter(deps({ getArchiveRepo: () => makeArchiveRepo(rows) })),
    );
    const res = await app.request("/api/archives/run-1/llm.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("# Today in AI");
    expect(body).toContain("> A summary.");
  });

  it("returns 404 for an unreviewed run", async () => {
    const rows = [archiveRow({ id: "run-1", reviewed: false })];
    const app = new Hono();
    app.route(
      "/api/archives",
      createLlmTxtArchiveRouter(deps({ getArchiveRepo: () => makeArchiveRepo(rows) })),
    );
    const res = await app.request("/api/archives/run-1/llm.txt");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing run", async () => {
    const app = new Hono();
    app.route("/api/archives", createLlmTxtArchiveRouter(deps({})));
    const res = await app.request("/api/archives/nope/llm.txt");
    expect(res.status).toBe(404);
  });
});

describe("llm.txt caching (behavioral)", () => {
  it("serves the second /llms-full.txt from cache without re-hydrating", async () => {
    const rows = [
      archiveRow({ id: "run-1", rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "x" }] }),
    ];
    const raw = makeRawRepo([rawItem({ id: 1, title: "S", url: "https://e.com/1" })]);
    const findByIds = raw.findByIds as ReturnType<typeof vi.fn>;
    const cache = makeMemoryCache();
    const app = new Hono();
    app.route(
      "/",
      createLlmTxtRouter(
        deps({
          getArchiveRepo: () => makeArchiveRepo(rows),
          getRawItemsRepo: () => raw,
          cache,
        }),
      ),
    );

    const first = await (await app.request("/llms-full.txt")).text();
    const hydrationCallsAfterFirst = findByIds.mock.calls.length;
    expect(hydrationCallsAfterFirst).toBeGreaterThan(0);

    const second = await (await app.request("/llms-full.txt")).text();
    expect(second).toBe(first);
    // Cache hit: no further hydration happened.
    expect(findByIds.mock.calls.length).toBe(hydrationCallsAfterFirst);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("regenerates when a published issue changes (version key changes)", async () => {
    const cache = makeMemoryCache();
    const v1Rows = [archiveRow({ id: "run-1", digestHeadline: "Old headline" })];
    const app1 = new Hono();
    app1.route(
      "/",
      createLlmTxtRouter(deps({ getArchiveRepo: () => makeArchiveRepo(v1Rows), cache })),
    );
    const first = await (await app1.request("/llms.txt")).text();
    expect(first).toContain("Old headline");

    // A new run is published → different signature → must regenerate, not serve stale.
    const v2Rows = [
      archiveRow({
        id: "run-2",
        digestHeadline: "New headline",
        completedAt: new Date("2026-06-18T10:00:00Z"),
        publishedAt: new Date("2026-06-18T10:00:00Z"),
      }),
      ...v1Rows,
    ];
    const app2 = new Hono();
    app2.route(
      "/",
      createLlmTxtRouter(deps({ getArchiveRepo: () => makeArchiveRepo(v2Rows), cache })),
    );
    const second = await (await app2.request("/llms.txt")).text();
    expect(second).toContain("New headline");
    expect(second).not.toBe(first);
    expect(cache.store.size).toBe(2); // two distinct version keys cached
  });

  it("still serves a correct response when the cache backend throws", async () => {
    const throwingCache: LlmTxtCache = {
      get: vi.fn(() => Promise.reject(new Error("redis down"))),
      set: vi.fn(() => Promise.reject(new Error("redis down"))),
    };
    const rows = [archiveRow({ id: "run-1" })];
    const app = new Hono();
    app.route(
      "/",
      createLlmTxtRouter(
        deps({ getArchiveRepo: () => makeArchiveRepo(rows), cache: throwingCache }),
      ),
    );
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    expect((await res.text()).startsWith("# ")).toBe(true);
  });

  it("per-issue endpoint caches and reuses by runId", async () => {
    const rows = [archiveRow({ id: "run-1", rankedItems: [{ rawItemId: 1, score: 1, rationale: "x" }] })];
    const raw = makeRawRepo([rawItem({ id: 1 })]);
    const findByIds = raw.findByIds as ReturnType<typeof vi.fn>;
    const cache = makeMemoryCache();
    const app = new Hono();
    app.route(
      "/api/archives",
      createLlmTxtArchiveRouter(
        deps({ getArchiveRepo: () => makeArchiveRepo(rows), getRawItemsRepo: () => raw, cache }),
      ),
    );
    await app.request("/api/archives/run-1/llm.txt");
    const after = findByIds.mock.calls.length;
    await app.request("/api/archives/run-1/llm.txt");
    expect(findByIds.mock.calls.length).toBe(after); // second served from cache
  });
});
