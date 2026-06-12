import { describe, it, expect } from "vitest";
import type { UserSettings } from "@newsletter/shared";
import { buildSourcesSummary } from "@api/services/sources-summary.js";
import type {
  RawItemsRepo,
  RawItemsAggregateRow,
} from "@api/repositories/raw-items.js";
import type {
  RangeFailureEntry,
  RecentSourceTelemetryEntry,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import type { UserSettingsRepo } from "@api/repositories/user-settings.js";
import type { SourceRecord, SourcesRepo } from "@api/repositories/sources.js";
import { settingsToSourceRows } from "@newsletter/shared/services/sources-assembler";

const NOW = new Date("2026-05-23T12:00:00.000Z");
const FROM = new Date("2026-05-16T12:00:00.000Z");
const TO = NOW;

function makeRawItemsRepo(agg: RawItemsAggregateRow[]): RawItemsRepo {
  return {
    findByIds: () => Promise.resolve([]),
    listForRun: () => Promise.resolve([]),
    aggregateBySourceAndIdentifier: () => Promise.resolve(agg),
  };
}

function makeRunArchivesRepo(opts: {
  digestCounts?: Map<string, number>;
  telemetry?: Map<string, RecentSourceTelemetryEntry>;
  failures?: RangeFailureEntry[];
  runsInRange?: number;
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
    getSourceFailuresInRange: () => Promise.resolve(opts.failures ?? []),
    countCompletedRunsInRange: () => Promise.resolve(opts.runsInRange ?? 0),
  };
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "settings",
    topN: 12,
    halfLifeHours: 24,
    hnEnabled: true,
    hnConfig: { sinceDays: 1 },
    redditEnabled: true,
    redditConfig: {
      subreddits: ["LocalLLaMA"],
      sort: "hot",
      limit: 25,
      sinceDays: 1,
    },
    webEnabled: true,
    webConfig: {
      sources: [
        { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
      ],
      maxItems: 10,
      sinceDays: 7,
    },
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: true,
    webSearchConfig: {
      provider: "tavily",
      queries: [{ query: "harness engineering", sinceDays: 7, maxItems: 5 }],
    },
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    scheduleTime: "07:00",
    pipelineTime: "07:00",
    emailTime: "07:30",
    linkedinTime: "07:45",
    twitterTime: "08:00",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: true,
    linkedinEnabled: true,
    twitterPostEnabled: true,
    autoReview: false,
    rankingPrompt: "prompt",
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeSettingsRepo(s: UserSettings | null): UserSettingsRepo {
  return {
    get: () => Promise.resolve(s),
    upsert: () => {
      throw new Error("n/a");
    },
  };
}

// Configured sections now derive from the sources table; mirror the
// settings fixture into enabled source rows (the write-through sync shape).
function makeSourcesRepoFromSettings(
  s: UserSettings | null,
): Pick<SourcesRepo, "listEnabled"> {
  const rows = s ? settingsToSourceRows(s) : [];
  return {
    listEnabled: () =>
      Promise.resolve(
        rows
          .filter((r) => r.enabled)
          .map(
            (r, i) =>
              ({
                id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
                type: r.type,
                config: r.config,
                enabled: true,
                health: null,
                createdAt: NOW,
                updatedAt: NOW,
              }) as SourceRecord,
          ),
      ),
  };
}

function makeDeps(s: UserSettings | null) {
  return {
    userSettingsRepo: makeSettingsRepo(s),
    sourcesRepo: makeSourcesRepoFromSettings(s),
  };
}

describe("buildSourcesSummary", () => {
  it("emits range with runsInRange and ISO from/to", async () => {
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo([]),
      runArchivesRepo: makeRunArchivesRepo({ runsInRange: 5 }),
      ...makeDeps(makeSettings()),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    expect(result.range).toEqual({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      runsInRange: 5,
    });
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it("filters sections to only configured identifiers", async () => {
    const agg: RawItemsAggregateRow[] = [
      // Configured Reddit row.
      {
        sourceType: "reddit",
        identifier: "r/localllama",
        url: "https://reddit.com/r/localllama/x",
        fetchedCount: 10,
        lastCollectedAt: NOW,
      },
      // Outbound link host — NOT configured, must be filtered out.
      {
        sourceType: "reddit",
        identifier: "huggingface.co",
        url: "https://huggingface.co/x",
        fetchedCount: 2,
        lastCollectedAt: NOW,
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo(agg),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(makeSettings()),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    const reddit = result.sections.find((s) => s.sourceType === "reddit");
    expect(reddit?.rows.map((r) => r.identifier)).toEqual(["r/localllama"]);
  });

  it("includes web_search rows regardless of identifier match", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "web_search",
        identifier: "web search",
        url: null,
        fetchedCount: 10,
        lastCollectedAt: NOW,
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo(agg),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(makeSettings()),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    const ws = result.sections.find((s) => s.sourceType === "web_search");
    expect(ws?.rows[0]?.fetchedCount).toBe(10);
  });

  it("builds configured rows per source type from the sources table", async () => {
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo([]),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(
        makeSettings({
          twitterEnabled: true,
          twitterConfig: {
            listIds: ["1234567890"],
            users: [{ handle: "karpathy", userId: "u1" }],
            maxTweetsPerSource: 100,
            sinceHours: 24,
          },
        }),
      ),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    const byType = new Map(result.configured.map((s) => [s.sourceType, s]));
    expect(byType.get("hn")?.rows[0]?.displayName).toBe("Hacker News");
    expect(byType.get("reddit")?.rows.map((r) => r.displayName)).toEqual([
      "r/localllama",
    ]);
    expect(byType.get("twitter")?.rows.map((r) => r.displayName)).toEqual([
      "@karpathy",
      "List #1234567890",
    ]);
    expect(byType.get("blog")?.rows[0]).toMatchObject({
      identifier: "anthropic.com",
      displayName: "Anthropic",
      url: "https://www.anthropic.com/news",
    });
    expect(byType.get("web_search")?.rows[0]?.displayName).toBe(
      '"harness engineering"',
    );
  });

  it("omits sections from configured when source disabled", async () => {
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo([]),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(
        makeSettings({ hnEnabled: false, redditEnabled: false }),
      ),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    const types = result.configured.map((s) => s.sourceType);
    expect(types).not.toContain("hn");
    expect(types).not.toContain("reddit");
  });

  it("hydrates failureCount and lastFailureMessage from failures aggregation", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/localllama",
        url: "https://reddit.com/r/localllama/x",
        fetchedCount: 5,
        lastCollectedAt: NOW,
      },
    ];
    const failures: RangeFailureEntry[] = [
      {
        sourceType: "reddit",
        identifier: "r/localllama",
        displayName: "r/localllama",
        runsAffected: 3,
        lastErrorMessage: "RSS 403",
        lastFailedAt: NOW,
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo(agg),
      runArchivesRepo: makeRunArchivesRepo({ failures }),
      ...makeDeps(makeSettings()),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    const row = result.sections
      .find((s) => s.sourceType === "reddit")
      ?.rows.find((r) => r.identifier === "r/localllama");
    expect(row?.failureCount).toBe(3);
    expect(row?.lastFailureMessage).toBe("RSS 403");
  });

  it("emits failures field at top level", async () => {
    const failures: RangeFailureEntry[] = [
      {
        sourceType: "twitter",
        identifier: "@karpathy",
        displayName: "@karpathy",
        runsAffected: 5,
        lastErrorMessage: "auth failed",
        lastFailedAt: new Date("2026-05-22T04:50:00.000Z"),
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo([]),
      runArchivesRepo: makeRunArchivesRepo({ failures }),
      ...makeDeps(makeSettings()),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    expect(result.failures).toEqual([
      {
        sourceType: "twitter",
        identifier: "@karpathy",
        displayName: "@karpathy",
        runsAffected: 5,
        lastErrorMessage: "auth failed",
        lastFailedAt: "2026-05-22T04:50:00.000Z",
      },
    ]);
  });

  it("sorts section rows alphabetically (case-insensitive) by displayName", async () => {
    const agg: RawItemsAggregateRow[] = [
      {
        sourceType: "reddit",
        identifier: "r/zeta",
        url: null,
        fetchedCount: 5,
        lastCollectedAt: NOW,
      },
      {
        sourceType: "reddit",
        identifier: "r/alpha",
        url: null,
        fetchedCount: 1,
        lastCollectedAt: NOW,
      },
    ];
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo(agg),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(
        makeSettings({
          redditConfig: {
            subreddits: ["Alpha", "zeta"],
            sort: "hot",
            limit: 25,
            sinceDays: 1,
          },
        }),
      ),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    expect(
      result.sections
        .find((s) => s.sourceType === "reddit")
        ?.rows.map((r) => r.identifier),
    ).toEqual(["r/alpha", "r/zeta"]);
  });

  it("returns empty configured when settings is null", async () => {
    const result = await buildSourcesSummary({
      rawItemsRepo: makeRawItemsRepo([]),
      runArchivesRepo: makeRunArchivesRepo({}),
      ...makeDeps(null),
      from: FROM,
      to: TO,
      now: () => NOW,
    });
    expect(result.configured).toEqual([]);
    expect(result.rankingPrompt).toBe("");
  });
});
