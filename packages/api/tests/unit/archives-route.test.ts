import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { RunState } from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";

function makeRepo(rows: RawItemRow[] = []): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve(rows)),
  };
}

function makeArchiveRepo(row: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
  };
}

function makeApp(opts: {
  repo?: RawItemsRepo;
  archiveRepo: RunArchivesRepo;
}): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => opts.repo ?? makeRepo(),
    getArchiveRepo: () => opts.archiveRepo,
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
      profileName: "alice",
      completedAt,
      createdAt: completedAt,
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
      profileName: null,
      completedAt,
      createdAt: completedAt,
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
      profileName: null,
      completedAt,
      createdAt: completedAt,
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
      profileName: null,
      completedAt,
      createdAt: completedAt,
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
