import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type {
  RawItemSummary,
  RunSourcesResponse,
} from "@newsletter/shared";
import type {
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { createAdminRunsRouter } from "@api/routes/admin-runs.js";
import { requireAdmin } from "@api/auth/middleware.js";
import { issueToken } from "@api/auth/session.js";
import { NotFoundError } from "@api/lib/errors.js";

const SESSION_SECRET = "test-session-secret";
const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function makeRepo(
  result: RawItemSummary[] | Error,
): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve([])),
    listForRun: vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
}

function makeArchiveRepo(row: RunArchiveRow | null): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    searchReviewed: vi.fn(() => Promise.resolve({ archives: [], total: 0 })),
    findMostRecentReviewed: vi.fn(() => Promise.resolve(null)),
    updateRankedItems: vi.fn(() => Promise.resolve(row as RunArchiveRow)),
    findPoolItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    markLinkedInPosted: vi.fn(() => Promise.resolve()),
    markTwitterPosted: vi.fn(() => Promise.resolve()),
    recordSocialFailure: vi.fn(() => Promise.resolve()),
  };
}

function makeRedis(): IORedis {
  return {
    get: vi.fn(() => Promise.resolve(null)),
  } as unknown as IORedis;
}

function makeApp(opts: {
  repo: RawItemsRepo;
  protected?: boolean;
}): Hono {
  const app = new Hono();
  if (opts.protected) {
    app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  }
  const router = createAdminRunsRouter({
    redis: makeRedis(),
    getRawItemsRepo: () => opts.repo,
    getArchiveRepo: () => makeArchiveRepo(null),
    getRunLogRepo: () => ({ listForRun: vi.fn(() => Promise.resolve([])) }),
  });
  app.route("/api/admin/runs", router);
  return app;
}

function adminCookie(): string {
  const token = issueToken(SESSION_SECRET, Date.now());
  return `admin_session=${token}`;
}

describe("GET /api/admin/runs/:runId/sources", () => {
  it("returns 200 with sources for an authed admin", async () => {
    const items: RawItemSummary[] = [
      {
        id: 1,
        sourceType: "hn",
        title: "First",
        url: "https://x/1",
        author: "alice",
        imageUrl: null,
        publishedAt: "2026-05-01T08:30:00.000Z",
        collectedAt: "2026-05-01T08:31:00.000Z",
        engagement: { points: 10, commentCount: 2 },
      },
      {
        id: 2,
        sourceType: "reddit",
        title: "Second",
        url: "https://x/2",
        author: null,
        imageUrl: null,
        publishedAt: null,
        collectedAt: "2026-05-01T08:32:00.000Z",
        engagement: { points: 0, commentCount: 0 },
      },
    ];
    const app = makeApp({ repo: makeRepo(items), protected: true });
    const res = await app.request(`/api/admin/runs/${VALID_UUID}/sources`, {
      headers: { cookie: adminCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunSourcesResponse;
    expect(body.runId).toBe(VALID_UUID);
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("content");
    }
  });

  it("returns 401 without admin cookie", async () => {
    const app = makeApp({ repo: makeRepo([]), protected: true });
    const res = await app.request(`/api/admin/runs/${VALID_UUID}/sources`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID runId", async () => {
    const app = makeApp({ repo: makeRepo([]) });
    const res = await app.request(`/api/admin/runs/not-a-uuid/sources`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the repo throws NotFoundError", async () => {
    const app = makeApp({ repo: makeRepo(new NotFoundError("run not found")) });
    const res = await app.request(`/api/admin/runs/${VALID_UUID}/sources`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Run not found");
  });

  it("returns 200 with empty items when the repo returns []", async () => {
    const app = makeApp({ repo: makeRepo([]) });
    const res = await app.request(`/api/admin/runs/${VALID_UUID}/sources`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunSourcesResponse;
    expect(body.items).toEqual([]);
  });
});
