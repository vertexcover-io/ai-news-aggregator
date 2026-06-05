import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ArchiveListItem, ArchiveListResponse } from "@newsletter/shared";
import { createArchivesRouter } from "@api/routes/archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

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

function makeSettingsRepo(timezone: string): Pick<UserSettingsRepo, "get"> {
  return {
    get: vi.fn(() =>
      Promise.resolve({
        scheduleTimezone: timezone,
      } as Awaited<ReturnType<UserSettingsRepo["get"]>>),
    ),
  };
}

function makeApp(
  archiveRepo: RunArchivesRepo,
  settingsRepo?: Pick<UserSettingsRepo, "get">,
): Hono {
  const app = new Hono();
  const router = createArchivesRouter({
    getRawItemsRepo: () => makeRawItemsRepo(),
    getArchiveRepo: () => archiveRepo,
    getSettingsRepo: settingsRepo === undefined ? undefined : () => settingsRepo,
  });
  app.route("/api/archives", router);
  return app;
}

describe("GET /api/archives (REQ-011)", () => {
  // The route does no filtering/ordering/formatting — `listReviewed` produces
  // runDate/topItems/order. The repo's hydration + ordering is covered by
  // repositories/run-archives.test.ts and archives.e2e.test.ts; here we only
  // smoke that the route surfaces the repo output verbatim and forwards the tz.
  it("EDGE-1: returns 200 with the repo's reviewed listing verbatim (smoke)", async () => {
    const archiveRepo = makeArchiveRepo([
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3, topItems: [], leadSummary: null },
    ]);
    const app = makeApp(archiveRepo);
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveListResponse;
    expect(body.archives).toEqual([
      { runId: "run-a", runDate: "2026-04-15", storyCount: 3, topItems: [], leadSummary: null },
    ]);
  });

  it("REQ-001: forwards the admin settings timezone to the archive repo", async () => {
    const archiveRepo = makeArchiveRepo([]);
    const app = makeApp(archiveRepo, makeSettingsRepo("Asia/Kolkata"));
    const res = await app.request("/api/archives");
    expect(res.status).toBe(200);
    expect(archiveRepo.listReviewed).toHaveBeenCalledWith({
      rawItemsRepo: expect.any(Object),
      timezone: "Asia/Kolkata",
    });
  });
});
