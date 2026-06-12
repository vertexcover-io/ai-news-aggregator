import { describe, expect, it, vi } from "vitest";
import type IORedis from "ioredis";
import { runKey } from "@newsletter/shared";
import type { RunLogEntry, RunState } from "@newsletter/shared/types";
import type { RunArchiveRow, RunArchivesRepo } from "@api/repositories/run-archives.js";
import type {
  RawItemWithEnrichment,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";
import type { RunLogRepo } from "@api/repositories/run-logs.js";
import { buildRunSourceItems } from "../run-source-items.js";
import { NotFoundError } from "@api/lib/errors.js";

const RUN_ID = "11111111-1111-1111-1111-111111111111";

function makeRedis(state: RunState | null): Pick<IORedis, "get"> {
  return {
    get: vi.fn((key: string) =>
      key === runKey(RUN_ID) && state !== null
        ? Promise.resolve(JSON.stringify(state))
        : Promise.resolve(null),
    ),
  } as unknown as Pick<IORedis, "get">;
}

function makeArchive(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  return {
    id: RUN_ID,
    status: "completed",
    rankedItems: [{ rawItemId: 3, score: 0.99, rationale: "top" }],
    topN: 5,
    reviewed: false,
    completedAt: new Date("2026-05-25T00:10:00.000Z"),
    publishedAt: null,
    draftSavedAt: null,
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    startedAt: new Date("2026-05-25T00:00:00.000Z"),
    sourceTypes: ["reddit", "hn"],
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    twitterSummary: null,
    linkedinPostBody: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    isDryRun: false,
    costBreakdown: null,
    runFunnel: null,
    socialMetadata: null,
    shortlistedItemIds: [3],
    preReviewSnapshot: null,
    ...overrides,
  };
}

function makeArchiveRepo(row: RunArchiveRow | null): Pick<RunArchivesRepo, "findById"> {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
  };
}

function makeRawItem(
  overrides: Partial<RawItemWithEnrichment> & Pick<RawItemWithEnrichment, "id" | "title" | "url">,
): RawItemWithEnrichment {
  const defaults: RawItemWithEnrichment = {
    id: overrides.id,
    sourceType: "reddit",
    title: overrides.title,
    url: overrides.url,
    sourceUrl: null,
    author: "author",
    publishedAt: "2026-05-25T00:01:00.000Z",
    collectedAt: "2026-05-25T00:02:00.000Z",
    engagement: { points: 1, commentCount: 0 },
    enrichedLink: { url: overrides.url, fetchedAt: "2026-05-25T00:02:00.000Z", status: "ok" },
    sourceIdentifier: "r/ai_agents",
  };
  return { ...defaults, ...overrides };
}

function makeRawRepo(items: RawItemWithEnrichment[]): Pick<RawItemsRepo, "listForRunWithEnrichment"> {
  return {
    listForRunWithEnrichment: vi.fn(() => Promise.resolve(items)),
  };
}

function log(overrides: Partial<RunLogEntry> & { id: number }): RunLogEntry {
  const defaults: RunLogEntry = {
    id: overrides.id,
    runId: RUN_ID,
    ts: "2026-05-25T00:03:00.000Z",
    level: "info",
    stage: "collecting",
    source: "r/ai_agents",
    event: "source.completed",
    message: "source completed",
    context: null,
  };
  return { ...defaults, ...overrides };
}

function makeLogRepo(logs: RunLogEntry[]): Pick<RunLogRepo, "listForRunSource"> {
  return {
    listForRunSource: vi.fn(() => Promise.resolve(logs)),
  };
}

describe("buildRunSourceItems", () => {
  it("REQ-004/REQ-006/REQ-009: classifies and orders one source while computing dedup over the whole run pool", async () => {
    const sourceWinner = makeRawItem({
      id: 1,
      title: "Source duplicate winner",
      url: "https://example.com/story?utm_source=newsletter",
      engagement: { points: 30, commentCount: 4 },
    });
    const sourceDropped = makeRawItem({
      id: 2,
      title: "Source duplicate loser",
      url: "https://example.com/story",
      engagement: { points: 5, commentCount: 1 },
    });
    const ranked = makeRawItem({
      id: 3,
      title: "Ranked source item",
      url: "https://reddit.com/r/AI_Agents/comments/ranked/post",
      engagement: { points: 10, commentCount: 2 },
    });
    const otherSourceWinner = makeRawItem({
      id: 4,
      sourceType: "hn",
      sourceIdentifier: "news.ycombinator.com",
      title: "Other source wins globally",
      url: "https://global.example.com/story",
      engagement: { points: 100, commentCount: 10 },
    });
    const sourceGlobalDropped = makeRawItem({
      id: 5,
      title: "Source loses to other source",
      url: "https://global.example.com/story",
      engagement: { points: 1, commentCount: 0 },
    });

    const result = await buildRunSourceItems(RUN_ID, encodeURIComponent("reddit:r/AI_Agents"), {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchive()),
      rawItemsRepo: makeRawRepo([
        sourceWinner,
        sourceDropped,
        ranked,
        otherSourceWinner,
        sourceGlobalDropped,
      ]),
      runLogRepo: makeLogRepo([log({ id: 10 })]),
    });

    expect(result.live).toBe(false);
    expect(result.sourceKey).toBe("reddit:r/ai_agents");
    expect(result.items.map((item) => item.id)).toEqual([3, 1, 2, 5]);
    expect(result.summary).toEqual({
      ranked: 1,
      shortlisted: 0,
      dedupedSurvivors: 1,
      dedupDropped: 2,
      enrichFailed: 0,
    });
    expect(result.items[2]?.dropReason).toContain("Source duplicate winner");
    expect(result.items[2]?.dropReason).toContain("(30 vs 5 pts)");
    expect(result.items[3]?.dropReason).toContain("Other source wins globally");
    expect(result.items[3]?.dropReason).toContain("(100 vs 1 pts)");
    expect(result.logs).toHaveLength(1);
  });

  it("REQ-011/EDGE-008: returns empty items with source logs for an existing run and unmatched source", async () => {
    const result = await buildRunSourceItems(RUN_ID, encodeURIComponent("twitter:@karpathy"), {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchive()),
      rawItemsRepo: makeRawRepo([]),
      runLogRepo: makeLogRepo([
        log({
          id: 11,
          level: "error",
          source: "twitter",
          event: "source.failed",
          message: "collector failed",
          context: { errors: ["auth failed"] },
        }),
      ]),
    });

    expect(result.items).toEqual([]);
    expect(result.summary).toEqual({
      ranked: 0,
      shortlisted: 0,
      dedupedSurvivors: 0,
      dedupDropped: 0,
      enrichFailed: 0,
    });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.event).toBe("source.failed");
  });

  it("REQ-014: omits markdown, recap, and cost fields from the response", async () => {
    const result = await buildRunSourceItems(RUN_ID, encodeURIComponent("reddit:r/AI_Agents"), {
      redis: makeRedis(null),
      archiveRepo: makeArchiveRepo(makeArchive({ costBreakdown: { totalCostUsd: 99 } as never })),
      rawItemsRepo: makeRawRepo([
        makeRawItem({
          id: 9,
          title: "Lean payload item",
          url: "https://reddit.com/r/AI_Agents/comments/lean/post",
          enrichedLink: {
            url: "https://reddit.com/r/AI_Agents/comments/lean/post",
            fetchedAt: "2026-05-25T00:02:00.000Z",
            status: "ok",
            markdown: "# full text that must not leak",
          },
        }),
      ]),
      runLogRepo: makeLogRepo([]),
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("markdown");
    expect(serialized).not.toContain("recap");
    expect(serialized).not.toContain("totalCostUsd");
  });

  it("returns 404 when neither Redis nor the archive repo knows the run", async () => {
    await expect(
      buildRunSourceItems(RUN_ID, encodeURIComponent("reddit:r/AI_Agents"), {
        redis: makeRedis(null),
        archiveRepo: makeArchiveRepo(null),
        rawItemsRepo: makeRawRepo([]),
        runLogRepo: makeLogRepo([]),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("test_REQ_013_source_items_tenant_fence: another tenant's live state reads as not-found", async () => {
    const liveState: RunState = {
      id: RUN_ID,
      status: "running",
      stage: "collecting",
      topN: 10,
      startedAt: "2026-06-11T10:00:00.000Z",
      updatedAt: "2026-06-11T10:01:00.000Z",
      completedAt: null,
      sources: {},
      rankedItems: null,
      shortlistedItemIds: null,
      warnings: [],
      error: null,
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    await expect(
      buildRunSourceItems(RUN_ID, encodeURIComponent("reddit:r/AI_Agents"), {
        redis: makeRedis(liveState),
        archiveRepo: makeArchiveRepo(null),
        rawItemsRepo: makeRawRepo([]),
        runLogRepo: makeLogRepo([]),
        requesterScope: {
          tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "tenant_admin",
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
