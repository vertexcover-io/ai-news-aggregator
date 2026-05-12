import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type { RunState } from "@newsletter/shared";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { listRawItemsForRun } from "@api/repositories/raw-items.js";
import { NotFoundError } from "@api/services/review.js";

interface DbRow {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  author: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  collectedAt: Date;
  engagement: { points: number; commentCount: number };
}

interface FakeDbCalls {
  whereArgs: unknown;
  orderByArgs: unknown;
}

function makeDb(
  rows: DbRow[],
): { db: Pick<AppDb, "select">; calls: FakeDbCalls } {
  const calls: FakeDbCalls = { whereArgs: undefined, orderByArgs: undefined };
  const db = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          calls.whereArgs = w;
          return {
            orderBy: (...args: unknown[]) => {
              calls.orderByArgs = args;
              return Promise.resolve(rows);
            },
          };
        },
      }),
    }),
  } as unknown as Pick<AppDb, "select">;
  return { db, calls };
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

interface FakeRedis {
  client: IORedis;
  get: ReturnType<typeof vi.fn>;
}

function makeRedis(store: Record<string, string> = {}): FakeRedis {
  const get = vi.fn((key: string) => Promise.resolve(store[key] ?? null));
  return {
    client: { get } as unknown as IORedis,
    get,
  };
}

const RUN_ID = "11111111-1111-1111-1111-111111111111";

function makeArchive(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [],
    topN: 5,
    reviewed: false,
    completedAt: new Date("2026-05-01T10:00:00Z"),
    createdAt: new Date("2026-05-01T09:00:00Z"),
    startedAt: new Date("2026-05-01T08:00:00Z"),
    sourceTypes: ["hn", "reddit"],
    digestHeadline: null,
    digestSummary: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    ...overrides,
  };
}

describe("listRawItemsForRun", () => {
  it("returns items mapped from the archive window (archive-present path)", async () => {
    const collectedAt = new Date("2026-05-01T08:30:00Z");
    const publishedAt = new Date("2026-05-01T08:00:00Z");
    const rows: DbRow[] = [
      {
        id: 1,
        sourceType: "hn",
        title: "First",
        url: "https://x/1",
        author: "alice",
        imageUrl: null,
        publishedAt,
        collectedAt,
        engagement: { points: 10, commentCount: 2 },
      },
      {
        id: 2,
        sourceType: "reddit",
        title: "Second",
        url: "https://x/2",
        author: null,
        imageUrl: "https://img/2",
        publishedAt: null,
        collectedAt,
        engagement: { points: 0, commentCount: 0 },
      },
    ];
    const { db } = makeDb(rows);
    const archiveRepo = makeArchiveRepo(makeArchive());
    const redis = makeRedis();

    const result = await listRawItemsForRun(RUN_ID, {
      db,
      archiveRepo,
      redis: redis.client,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 1,
      sourceType: "hn",
      title: "First",
      url: "https://x/1",
      author: "alice",
      imageUrl: null,
      publishedAt: publishedAt.toISOString(),
      collectedAt: collectedAt.toISOString(),
      engagement: { points: 10, commentCount: 2 },
    });
    expect(result[1].publishedAt).toBeNull();
    // content is not in the shape
    expect(Object.keys(result[0])).not.toContain("content");
    // Redis fallback should not be touched when archive is present
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("falls back to Redis run-state when archive is missing", async () => {
    const { db } = makeDb([]);
    const archiveRepo = makeArchiveRepo(null);
    const state: RunState = {
      id: RUN_ID,
      status: "running",
      stage: "collecting",
      topN: 5,
      startedAt: "2026-05-01T08:00:00.000Z",
      updatedAt: "2026-05-01T08:30:00.000Z",
      completedAt: null,
      sources: {
        hn: { status: "running", itemsFetched: 0, errors: [] },
        twitter: { status: "pending", itemsFetched: 0, errors: [] },
      },
      rankedItems: null,
      warnings: [],
      error: null,
    };
    const redis = makeRedis({ [`run:${RUN_ID}`]: JSON.stringify(state) });

    const result = await listRawItemsForRun(RUN_ID, { db, archiveRepo, redis: redis.client });

    expect(result).toEqual([]);
    expect(redis.get).toHaveBeenCalledWith(`run:${RUN_ID}`);
  });

  it("throws NotFoundError when neither archive nor Redis state exists", async () => {
    const { db } = makeDb([]);
    const archiveRepo = makeArchiveRepo(null);
    const redis = makeRedis();

    await expect(
      listRawItemsForRun(RUN_ID, { db, archiveRepo, redis: redis.client }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns [] when archive exists but no raw_items match", async () => {
    const { db } = makeDb([]);
    const archiveRepo = makeArchiveRepo(makeArchive());
    const redis = makeRedis();

    const result = await listRawItemsForRun(RUN_ID, { db, archiveRepo, redis: redis.client });
    expect(result).toEqual([]);
  });

  it("throws NotFoundError when archive lacks startedAt/sourceTypes and Redis is empty", async () => {
    const { db } = makeDb([]);
    const archiveRepo = makeArchiveRepo(
      makeArchive({ startedAt: null, sourceTypes: null }),
    );
    const redis = makeRedis();

    await expect(
      listRawItemsForRun(RUN_ID, { db, archiveRepo, redis: redis.client }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
