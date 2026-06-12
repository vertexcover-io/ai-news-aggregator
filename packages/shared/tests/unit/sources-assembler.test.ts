import { describe, it, expect } from "vitest";
import {
  assembleRunConfigs,
  settingsToSourceRows,
  DEFAULT_WEB_MAX_ITEMS,
  DEFAULT_WEB_SEARCH_PROVIDER,
  type AssemblableSourceRow,
} from "@shared/services/sources-assembler.js";
import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
} from "@shared/types/run.js";

// Pre-lift AGENTLOOP-shaped user_settings configs (the shapes collectors consume).
const hnConfig: RunSubmitHnConfig = {
  keywords: ["llm", "agents"],
  pointsThreshold: 50,
  sinceDays: 1,
  feeds: ["best"],
  count: 200,
  commentsPerItem: 10,
};

const redditConfig: RunSubmitRedditConfig = {
  subreddits: ["LocalLLaMA", "MachineLearning"],
  sort: "top",
  limit: 50,
  sinceDays: 2,
};

const webConfig: RunSubmitWebConfig = {
  sources: [
    { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
    { name: "OpenAI", listingUrl: "https://openai.com/blog" },
  ],
  maxItems: 12,
  sinceDays: 7,
};

const twitterConfig: RunSubmitTwitterConfig = {
  listIds: ["111", "222"],
  users: [
    { handle: "openai", userId: "9001" },
    { handle: "anthropicai", userId: "9002" },
  ],
  maxTweetsPerSource: 50,
  sinceHours: 24,
};

const webSearchConfig: RunSubmitWebSearchConfig = {
  provider: "tavily",
  queries: [
    { query: "AI agents news", sinceDays: 1, maxItems: 10 },
    { query: "LLM evals", sinceDays: 3, maxItems: 5 },
  ],
};

/**
 * TS mirror of the 0041 lift (sources rows produced from the legacy settings
 * JSONB). Row shapes must stay in sync with
 * packages/shared/src/db/migrations/0041_backfill_tenant_zero.sql.
 */
function liftedRows(): AssemblableSourceRow[] {
  return [
    { type: "hn", config: hnConfig },
    ...redditConfig.subreddits.map((subreddit) => ({
      type: "reddit" as const,
      config: {
        subreddit,
        sort: redditConfig.sort,
        limit: redditConfig.limit,
        sinceDays: redditConfig.sinceDays,
      },
    })),
    ...webConfig.sources.map((source) => ({ type: "web" as const, config: source })),
    ...twitterConfig.listIds.map((listId) => ({
      type: "twitter" as const,
      config: { kind: "list" as const, listId },
    })),
    ...twitterConfig.users.map((u) => ({
      type: "twitter" as const,
      config: { kind: "user" as const, handle: u.handle, userId: u.userId },
    })),
    ...webSearchConfig.queries.map((q) => ({ type: "web_search" as const, config: q })),
  ];
}

const legacyTuning = {
  webConfig: { maxItems: webConfig.maxItems, sinceDays: webConfig.sinceDays },
  twitterConfig: {
    maxTweetsPerSource: twitterConfig.maxTweetsPerSource,
    sinceHours: twitterConfig.sinceHours,
  },
  webSearchConfig: { provider: webSearchConfig.provider },
};

describe("assembleRunConfigs", () => {
  // REQ-070: lifted rows + legacy tuning round-trip back to the pre-lift shapes.
  it("REQ-070: round-trips the lifted AGENTLOOP rows into the pre-lift configs", () => {
    const assembled = assembleRunConfigs(liftedRows(), legacyTuning);
    expect(assembled).toEqual({
      hn: hnConfig,
      reddit: redditConfig,
      web: webConfig,
      twitter: twitterConfig,
      webSearch: webSearchConfig,
    });
  });

  it("REQ-070: merges the dropped knobs from legacy settings (maxItems/sinceDays, maxTweetsPerSource/sinceHours, provider)", () => {
    const assembled = assembleRunConfigs(liftedRows(), legacyTuning);
    expect(assembled.web?.maxItems).toBe(12);
    expect(assembled.web?.sinceDays).toBe(7);
    expect(assembled.twitter?.maxTweetsPerSource).toBe(50);
    expect(assembled.twitter?.sinceHours).toBe(24);
    expect(assembled.webSearch?.provider).toBe("tavily");
  });

  it("uses sane defaults for new tenants with no legacy tuning", () => {
    const assembled = assembleRunConfigs(liftedRows(), null);
    expect(assembled.web?.maxItems).toBe(DEFAULT_WEB_MAX_ITEMS);
    expect(assembled.web).not.toHaveProperty("sinceDays");
    expect(assembled.twitter).not.toHaveProperty("maxTweetsPerSource");
    expect(assembled.twitter).not.toHaveProperty("sinceHours");
    expect(assembled.webSearch?.provider).toBe(DEFAULT_WEB_SEARCH_PROVIDER);
  });

  it("omits collector keys that have no rows", () => {
    expect(assembleRunConfigs([], legacyTuning)).toEqual({});
    const onlyHn = assembleRunConfigs([{ type: "hn", config: { sinceDays: 1 } }], null);
    expect(onlyHn).toEqual({ hn: { sinceDays: 1 } });
    expect(Object.keys(onlyHn)).toEqual(["hn"]);
  });

  it("groups reddit rows into a single subreddits config preserving row order", () => {
    const assembled = assembleRunConfigs(
      [
        { type: "reddit", config: { subreddit: "a", sinceDays: 1 } },
        { type: "reddit", config: { subreddit: "b", sinceDays: 1 } },
      ],
      null,
    );
    expect(assembled.reddit).toEqual({ subreddits: ["a", "b"], sinceDays: 1 });
  });

  it("splits twitter rows into listIds and users", () => {
    const assembled = assembleRunConfigs(
      [
        { type: "twitter", config: { kind: "user", handle: "x", userId: "1" } },
        { type: "twitter", config: { kind: "list", listId: "42" } },
      ],
      null,
    );
    expect(assembled.twitter).toEqual({
      listIds: ["42"],
      users: [{ handle: "x", userId: "1" }],
    });
  });
});

describe("settingsToSourceRows", () => {
  const legacySettings = {
    hnEnabled: true,
    hnConfig,
    redditEnabled: true,
    redditConfig,
    webEnabled: false,
    webConfig,
    twitterEnabled: true,
    twitterConfig,
    webSearchEnabled: true,
    webSearchConfig,
  };

  it("mirrors the 0041 lift: one row per source, enabled = legacy flag", () => {
    const rows = settingsToSourceRows(legacySettings);
    expect(rows).toEqual(
      liftedRows().map((row) => ({
        ...row,
        enabled: row.type === "web" ? false : true,
      })),
    );
  });

  it("round-trips: exploded rows + legacy tuning reassemble to the original configs", () => {
    const rows = settingsToSourceRows({ ...legacySettings, webEnabled: true });
    expect(assembleRunConfigs(rows, legacyTuning)).toEqual({
      hn: hnConfig,
      reddit: redditConfig,
      web: webConfig,
      twitter: twitterConfig,
      webSearch: webSearchConfig,
    });
  });

  it("emits no rows for null configs", () => {
    expect(
      settingsToSourceRows({
        hnEnabled: true,
        hnConfig: null,
        redditEnabled: true,
        redditConfig: null,
        webEnabled: true,
        webConfig: null,
        twitterEnabled: true,
        twitterConfig: null,
        webSearchEnabled: true,
        webSearchConfig: null,
      }),
    ).toEqual([]);
  });

  it("omits absent optional reddit knobs like jsonb_strip_nulls", () => {
    const rows = settingsToSourceRows({
      ...legacySettings,
      redditConfig: { subreddits: ["a"], sinceDays: 3 },
      hnConfig: null,
      webConfig: null,
      twitterConfig: null,
      webSearchConfig: null,
    });
    expect(rows).toEqual([
      { type: "reddit", config: { subreddit: "a", sinceDays: 3 }, enabled: true },
    ]);
  });
});
