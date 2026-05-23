import { describe, it, expect } from "vitest";
import type { SourceType, UserSettings } from "@newsletter/shared";
import { buildSourcesSummary } from "@api/services/sources-summary.js";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";

interface FakeRawItemsState {
  agg: RawItemsAggregateRow[];
}

function makeRawItemsRepo(state: FakeRawItemsState): RawItemsRepo {
  return {
    findByIds: () => Promise.resolve([]),
    listForRun: () => Promise.resolve([]),
    aggregateBySourceAndIdentifier: () => Promise.resolve(state.agg),
  };
}

function makeRunArchivesRepo(opts: {
  digestCounts?: Map<string, number>;
  telemetry?: Map<
    string,
    {
      displayName: string;
      status: "completed" | "failed" | "partial";
      itemsFetched: number;
      completedAt: Date;
    }
  >;
}): RunArchivesRepo {
  return {
    findById: () => Promise.resolve(null),
    list: () => Promise.resolve([]),
    listReviewed: () => Promise.resolve([]),
    searchReviewed: () => Promise.resolve({ archives: [], total: 0 }),
    findMostRecentReviewed: () => Promise.resolve(null),
    updateRankedItems: () => {
      throw new Error("n/a");
    },
    findPoolItems: () => Promise.resolve({ items: [], total: 0 }),
    markSlackNotified: () => Promise.resolve(),
    markEmailSent: () => Promise.resolve(),
    markNotification: () => Promise.resolve(),
    markLinkedInPosted: () => Promise.resolve(),
    markTwitterPosted: () => Promise.resolve(),
    recordSocialFailure: () => Promise.resolve(),
    delete: () => Promise.resolve({ deleted: false, removedEmailSends: 0 }),
    getReviewedDigestCountsByDerivedSource: () =>
      Promise.resolve(opts.digestCounts ?? new Map()),
    getRecentSourceTelemetry: () =>
      Promise.resolve(opts.telemetry ?? new Map()),
  };
}

function makeSettingsRepo(rankingPrompt: string): UserSettingsRepo {
  return {
    get: () =>
      Promise.resolve({
        rankingPrompt,
      } as unknown as UserSettings),
    upsert: () => {
      throw new Error("n/a");
    },
  };
}

const NOW = new Date("2026-05-23T12:00:00.000Z");

describe("buildSourcesSummary", () => {
  it("returns sections in SOURCE_TYPE_ORDER and omits empty sections", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "blog",
        identifier: "anthropic.com",
        url: "https://anthropic.com/x",
        todayCount: 1,
        weekCount: 3,
        lastCollectedAt: new Date("2026-05-23T10:00:00.000Z"),
      },
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        url: "https://news.ycombinator.com/item?id=1",
        todayCount: 2,
        weekCount: 5,
        lastCollectedAt: new Date("2026-05-23T11:00:00.000Z"),
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo("prompt"),
      now: () => NOW,
    });
    expect(result.sections.map((s) => s.sourceType)).toEqual(["hn", "blog"]);
  });

  it("sorts rows by todayCount desc then displayName asc (case-insensitive)", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/LocalLLaMA",
        url: "https://reddit.com/r/LocalLLaMA/comments/x",
        todayCount: 3,
        weekCount: 5,
        lastCollectedAt: new Date("2026-05-23T11:00:00.000Z"),
      },
      {
        sourceType: "reddit",
        identifier: "r/MachineLearning",
        url: "https://reddit.com/r/MachineLearning/comments/x",
        todayCount: 5,
        weekCount: 9,
        lastCollectedAt: new Date("2026-05-23T11:00:00.000Z"),
      },
      {
        sourceType: "reddit",
        identifier: "r/aaa",
        url: "https://reddit.com/r/aaa/comments/x",
        todayCount: 5,
        weekCount: 7,
        lastCollectedAt: new Date("2026-05-23T11:00:00.000Z"),
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].rows.map((r) => r.identifier)).toEqual([
      "r/aaa",
      "r/MachineLearning",
      "r/LocalLLaMA",
    ]);
  });

  it("falls back displayName to identifier when no telemetry", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        url: "https://news.ycombinator.com/item?id=1",
        todayCount: 1,
        weekCount: 1,
        lastCollectedAt: NOW,
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    const row = result.sections[0].rows[0];
    expect(row.displayName).toBe("news.ycombinator.com");
  });

  it("uses telemetry.displayName when available", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/LocalLLaMA",
        url: "https://reddit.com/r/LocalLLaMA/comments/x",
        todayCount: 1,
        weekCount: 1,
        lastCollectedAt: NOW,
      },
    ];
    const telemetry = new Map([
      [
        "reddit r/LocalLLaMA",
        {
          displayName: "LocalLLaMA Subreddit",
          status: "completed" as const,
          itemsFetched: 5,
          completedAt: new Date("2026-05-23T08:00:00.000Z"),
        },
      ],
    ]);
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({ telemetry }),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].displayName).toBe("LocalLLaMA Subreddit");
  });

  it("classifies status: healthy", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "hn" as SourceType,
        identifier: "news.ycombinator.com",
        url: "https://x",
        todayCount: 1,
        weekCount: 1,
        lastCollectedAt: new Date("2026-05-22T00:00:00.000Z"),
      },
    ];
    const telemetry = new Map([
      [
        "hn news.ycombinator.com",
        {
          displayName: "HN",
          status: "completed" as const,
          itemsFetched: 5,
          completedAt: new Date("2026-05-22T00:00:00.000Z"),
        },
      ],
    ]);
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({ telemetry }),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].status).toBe("healthy");
  });

  it("classifies status: failing when telemetry.status=failed", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/x",
        url: "https://reddit.com/r/x/comments/y",
        todayCount: 1,
        weekCount: 1,
        lastCollectedAt: new Date("2026-05-22T00:00:00.000Z"),
      },
    ];
    const telemetry = new Map([
      [
        "reddit r/x",
        {
          displayName: "r/x",
          status: "failed" as const,
          itemsFetched: 0,
          completedAt: new Date("2026-05-22T00:00:00.000Z"),
        },
      ],
    ]);
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({ telemetry }),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].status).toBe("failing");
  });

  it("classifies status: failing when lastFetched older than 14 days", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "hn",
        identifier: "news.ycombinator.com",
        url: "https://x",
        todayCount: 0,
        weekCount: 0,
        lastCollectedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].status).toBe("failing");
  });

  it("classifies status: idle when partial telemetry but recent", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "blog",
        identifier: "x.com",
        url: "https://x.com/post",
        todayCount: 0,
        weekCount: 1,
        lastCollectedAt: new Date("2026-05-22T00:00:00.000Z"),
      },
    ];
    const telemetry = new Map([
      [
        "blog x.com",
        {
          displayName: "X",
          status: "partial" as const,
          itemsFetched: 1,
          completedAt: new Date("2026-05-22T00:00:00.000Z"),
        },
      ],
    ]);
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({ telemetry }),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].status).toBe("idle");
  });

  it("passes rankingPrompt through verbatim", async () => {
    const verbatim = "Some MULTI-line\n  prompt with\twhitespace.";
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg: [] }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo(verbatim),
      now: () => NOW,
    });
    expect(result.rankingPrompt).toBe(verbatim);
  });

  it("inDigestCount looks up by `${sourceType} ${identifier}`", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/LocalLLaMA",
        url: "https://reddit.com/r/LocalLLaMA/comments/y",
        todayCount: 5,
        weekCount: 8,
        lastCollectedAt: NOW,
      },
    ];
    const digestCounts = new Map([["reddit r/LocalLLaMA", 2]]);
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg }),
      runArchivesRepo: makeRunArchivesRepo({ digestCounts }),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.sections[0].rows[0].inDigestCount).toBe(2);
  });

  it("emits generatedAt as ISO string", async () => {
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg: [] }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: makeSettingsRepo("p"),
      now: () => NOW,
    });
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it.todo(
    "REQ-018 cross-check lives in e2e — see packages/api/tests/e2e/sources.e2e.test.ts",
  );

  it("handles null settings (rankingPrompt defaults to empty)", async () => {
    const settingsRepo: UserSettingsRepo = {
      get: () => Promise.resolve(null),
      upsert: () => {
        throw new Error("n/a");
      },
    };
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo({ agg: [] }),
      runArchivesRepo: makeRunArchivesRepo({}),
      userSettingsRepo: settingsRepo,
      now: () => NOW,
    });
    expect(result.rankingPrompt).toBe("");
  });
});
