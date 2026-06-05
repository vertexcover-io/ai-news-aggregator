import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { ArchiveListItem } from "@newsletter/shared";
import { createArchivesSearchRouter } from "@api/routes/archives-search.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

interface SearchInput {
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  rawItemsRepo?: RawItemsRepo;
  timezone?: string;
}

interface RepoStub extends RunArchivesRepo {
  searchReviewed: (input: SearchInput) => Promise<{ archives: ArchiveListItem[]; total: number }>;
}

function makeRepo(
  result: { archives: ArchiveListItem[]; total: number } = { archives: [], total: 0 },
): RepoStub {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(),
    findPoolItems: vi.fn(),
    markSlackNotified: vi.fn(),
    searchReviewed: vi.fn(() => Promise.resolve(result)),
  } as unknown as RepoStub;
}

function makeRawRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
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

interface LoggerStub {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

function makeLogger(): LoggerStub {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeApp(opts: {
  archiveRepo?: RepoStub;
  rawItemsRepo?: RawItemsRepo;
  logger?: LoggerStub;
  settingsRepo?: Pick<UserSettingsRepo, "get">;
} = {}): { app: Hono; archiveRepo: RepoStub; logger: LoggerStub } {
  const archiveRepo = opts.archiveRepo ?? makeRepo();
  const logger = opts.logger ?? makeLogger();
  const app = new Hono();
  const router = createArchivesSearchRouter({
    getArchiveRepo: () => archiveRepo,
    getRawItemsRepo: () => opts.rawItemsRepo ?? makeRawRepo(),
    ...(opts.settingsRepo === undefined
      ? {}
      : { getSettingsRepo: () => opts.settingsRepo }),
    logger: logger as unknown as Parameters<typeof createArchivesSearchRouter>[0]["logger"],
  });
  app.route("/api/archives/search", router);
  return { app, archiveRepo, logger };
}

describe("GET /api/archives/search — validation 400 cases", () => {
  it("REQ-024: q.length > 200 returns 400 with q-too-long", async () => {
    const longQ = "a".repeat(201);
    const { app } = makeApp();
    const res = await app.request(`/api/archives/search?q=${encodeURIComponent(longQ)}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("q-too-long");
  });

  it("REQ-025: from > to returns 400 with invalid-range", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/api/archives/search?from=2026-05-08&to=2026-05-01",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid-range");
  });

  // The remaining boundary cases all reject with a plain 400 (no specific error
  // body to assert). EDGE-010: zod max(50) rejects limit > 50 rather than
  // coercing — the cap is explicit at the validation boundary.
  it.each<{ name: string; query: string }>([
    { name: "REQ-026: from='garbage'", query: "from=garbage" },
    { name: "REQ-026: to='garbage'", query: "to=garbage" },
    { name: "EDGE-011: limit=-1", query: "limit=-1" },
    { name: "EDGE-011: limit=0", query: "limit=0" },
    { name: "EDGE-010: limit=1000 (over the cap of 50)", query: "limit=1000" },
  ])("$name returns 400", async ({ query }) => {
    const { app } = makeApp();
    const res = await app.request(`/api/archives/search?${query}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/archives/search — happy path shape and logging", () => {
  it("REQ-007: returns { archives, total, q?, from?, to? } shape", async () => {
    const archives: ArchiveListItem[] = [
      {
        runId: "r1",
        runDate: "2026-04-12",
        storyCount: 3,
        topItems: [],
        leadSummary: null,
        digestHeadline: null,
        digestSummary: null,
      },
    ];
    const repo = makeRepo({ archives, total: 1 });
    const { app } = makeApp({ archiveRepo: repo });
    const res = await app.request("/api/archives/search?q=foo");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archives: ArchiveListItem[];
      total: number;
      q?: string;
      from?: string;
      to?: string;
    };
    expect(Object.keys(body).sort()).toEqual(["archives", "q", "total"].sort());
    expect(body.archives).toEqual(archives);
    expect(body.total).toBe(1);
    expect(body.q).toBe("foo");
  });

  it("REQ-027: logs one structured info entry per request with q,from,to,count,durationMs", async () => {
    const repo = makeRepo({ archives: [], total: 0 });
    const logger = makeLogger();
    const { app } = makeApp({ archiveRepo: repo, logger });
    const res = await app.request(
      "/api/archives/search?q=hello&from=2026-04-01&to=2026-04-30",
    );
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [meta] = logger.info.mock.calls[0] as [Record<string, unknown>, string?];
    expect(meta).toMatchObject({
      q: "hello",
      from: "2026-04-01",
      to: "2026-04-30",
      count: 0,
    });
    expect(typeof meta.durationMs).toBe("number");
  });

  it("EDGE-001: empty q + no range returns archives without echoing q/from/to", async () => {
    const archives: ArchiveListItem[] = [];
    const repo = makeRepo({ archives, total: 0 });
    const { app } = makeApp({ archiveRepo: repo });
    const res = await app.request("/api/archives/search");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.archives).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.q).toBeUndefined();
    expect(body.from).toBeUndefined();
    expect(body.to).toBeUndefined();
  });

  it("REQ-003: converts date-only ranges using the admin settings timezone", async () => {
    const repo = makeRepo({ archives: [], total: 0 });
    const { app } = makeApp({
      archiveRepo: repo,
      settingsRepo: makeSettingsRepo("Asia/Kolkata"),
    });
    const res = await app.request(
      "/api/archives/search?from=2026-05-23&to=2026-05-23",
    );
    expect(res.status).toBe(200);
    expect(repo.searchReviewed).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date("2026-05-22T18:30:00.000Z"),
        to: new Date("2026-05-23T18:29:59.999Z"),
        timezone: "Asia/Kolkata",
      }),
    );
  });
});
