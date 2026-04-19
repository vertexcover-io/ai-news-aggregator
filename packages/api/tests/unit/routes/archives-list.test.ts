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
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3, topItems: [], leadSummary: null },
      { runId: "run-b", runDate: "2026-04-14", storyCount: 5, topItems: [], leadSummary: null },
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
      { runId: "newest", runDate: "2026-04-16", storyCount: 10, topItems: [], leadSummary: null },
      { runId: "middle", runDate: "2026-04-15", storyCount: 8, topItems: [], leadSummary: null },
      { runId: "oldest", runDate: "2026-04-14", storyCount: 4, topItems: [], leadSummary: null },
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
      { runId: "run-full", runDate: "2026-04-16", storyCount: 12, topItems: [], leadSummary: null },
      { runId: "run-empty", runDate: "2026-04-15", storyCount: 0, topItems: [], leadSummary: null },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives[0].storyCount).toBe(12);
    expect(body.archives[0].topItems).toEqual([]);
    expect(body.archives[0].leadSummary).toBeNull();
    expect(body.archives[1].storyCount).toBe(0);
    expect(body.archives[1].topItems).toEqual([]);
    expect(body.archives[1].leadSummary).toBeNull();
  });

  it("REQ-010: returns topItems and leadSummary in the response body", async () => {
    const archiveRepo = makeArchiveRepo([
      {
        runId: "run-a",
        runDate: "2026-04-18",
        storyCount: 12,
        topItems: [
          { id: 7, title: "Anthropic pricing shift", sourceType: "hn" },
          { id: 3, title: "Meta open-weights land in enterprise", sourceType: "reddit" },
          { id: 11, title: "Long-context benchmark", sourceType: "rss" },
        ],
        leadSummary: "New per-call pricing ladder kicks in May 1.",
      },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives[0].topItems).toHaveLength(3);
    expect(body.archives[0].topItems[0]).toEqual({
      id: 7,
      title: "Anthropic pricing shift",
      sourceType: "hn",
    });
    expect(body.archives[0].leadSummary).toBe(
      "New per-call pricing ladder kicks in May 1.",
    );
  });

  it("runDate is formatted as YYYY-MM-DD", async () => {
    const archiveRepo = makeArchiveRepo([
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3, topItems: [], leadSummary: null },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives[0].runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.archives[0].runDate).toBe("2026-04-15");
  });
});
