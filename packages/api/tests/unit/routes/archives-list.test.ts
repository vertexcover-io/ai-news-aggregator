import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ArchiveListItem, ArchiveListResponse } from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

function makeRawItemsRepo(): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve([])),
  };
}

function makeArchiveRepo(items: ArchiveListItem[]): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(null)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve(items)),
    updateRankedItems: vi.fn(() =>
      Promise.reject(new Error("not used in listing tests")),
    ),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  };
}

function makeApp(archiveRepo: RunArchivesRepo): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => makeRawItemsRepo(),
    getArchiveRepo: () => archiveRepo,
  });
  app.route("/api/archives", router);
  return app;
}

describe("GET /api/archives (REQ-011)", () => {
  it("EDGE-1: returns empty array when no reviewed archives", async () => {
    const archiveRepo = makeArchiveRepo([]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body).toEqual({ archives: [] });
  });

  it("returns only the reviewed=true rows (the repo filters; route forwards)", async () => {
    // The repo contract is to return only reviewed=true rows. The route test
    // verifies the route surfaces exactly what the repo returns — it does not
    // (and cannot) re-filter. We assert the route passes through the repo
    // output verbatim.
    const archiveRepo = makeArchiveRepo([
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3 },
      { runId: "run-b", runDate: "2026-04-14", storyCount: 5 },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives).toHaveLength(2);
    expect(body.archives.map((a) => a.runId)).toEqual(["run-a", "run-b"]);
    expect(archiveRepo.listReviewed).toHaveBeenCalledOnce();
  });

  it("preserves ordering from the repo (completedAt desc)", async () => {
    const archiveRepo = makeArchiveRepo([
      { runId: "newest", runDate: "2026-04-16", storyCount: 10 },
      { runId: "middle", runDate: "2026-04-15", storyCount: 8 },
      { runId: "oldest", runDate: "2026-04-14", storyCount: 4 },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives.map((a) => a.runId)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("EDGE-2: storyCount equals rankedItems length, including 0", async () => {
    const archiveRepo = makeArchiveRepo([
      { runId: "run-full", runDate: "2026-04-16", storyCount: 12 },
      { runId: "run-empty", runDate: "2026-04-15", storyCount: 0 },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives[0].storyCount).toBe(12);
    expect(body.archives[1].storyCount).toBe(0);
  });

  it("runDate is formatted as YYYY-MM-DD", async () => {
    const archiveRepo = makeArchiveRepo([
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3 },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives[0].runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.archives[0].runDate).toBe("2026-04-15");
  });
});
