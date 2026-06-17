/**
 * Unit: per-tenant source config helpers (P8, REQ-070/072).
 *
 * `buildSourceConfig` maps the Settings "Add manually" inputs (type select +
 * one text input) to a typed SourceConfig row payload; `sourceDisplayName`
 * derives the list label the Settings sources panel renders.
 */
import { describe, it, expect } from "vitest";
import {
  buildSourceConfig,
  sourceDisplayName,
} from "@shared/types/source.js";

describe("test_REQ_072_build_source_config_from_manual_input", () => {
  it.each([
    [
      "reddit",
      "r/LocalLLaMA",
      { kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 },
    ],
    [
      "reddit",
      "MachineLearning",
      { kind: "reddit", subreddit: "MachineLearning", sinceDays: 1 },
    ],
    [
      "twitter",
      "@tri_dao",
      { kind: "twitter_user", handle: "tri_dao" },
    ],
    [
      "blog",
      "https://vllm.ai/blog",
      { kind: "web", name: "vllm.ai", listingUrl: "https://vllm.ai/blog" },
    ],
    [
      "github",
      "https://github.com/trending",
      { kind: "web", name: "github.com", listingUrl: "https://github.com/trending" },
    ],
    [
      "web_search",
      "speculative decoding",
      {
        kind: "web_search",
        provider: "tavily",
        query: "speculative decoding",
        sinceDays: 7,
        maxItems: 10,
      },
    ],
  ] as const)("%s + %j → config", (type, value, expected) => {
    expect(buildSourceConfig(type, value)).toEqual(expected);
  });

  it("rejects an invalid listing URL for web-backed types", () => {
    expect(() => buildSourceConfig("blog", "not a url")).toThrow(/url/i);
  });

  it("rejects an empty value for types that need one", () => {
    expect(() => buildSourceConfig("reddit", "  ")).toThrow(/required/i);
    expect(() => buildSourceConfig("twitter", "")).toThrow(/required/i);
    expect(() => buildSourceConfig("web_search", "")).toThrow(/required/i);
  });

  // FIX #5: Hacker News needs keywords to search, which the single-input
  // manual-add path can't supply. HN is configured (with keywords) only via
  // the Settings panel reconcile path — so the manual builder must reject it.
  it("rejects manual HN add — HN is configured in Settings with keywords", () => {
    expect(() => buildSourceConfig("hn", "")).toThrow(/keyword|settings/i);
    expect(() => buildSourceConfig("hn", "hn")).toThrow(/keyword|settings/i);
  });
});

describe("sourceDisplayName", () => {
  it.each([
    [{ kind: "hn", sinceDays: 1 }, "Hacker News"],
    [{ kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 }, "r/LocalLLaMA"],
    [{ kind: "twitter_user", handle: "tri_dao" }, "@tri_dao"],
    [{ kind: "twitter_list", listId: "123" }, "List 123"],
    [
      { kind: "web", name: "vLLM blog", listingUrl: "https://vllm.ai/blog" },
      "vLLM blog",
    ],
    [
      {
        kind: "web_search",
        provider: "tavily",
        query: "agentic ai",
        sinceDays: 7,
        maxItems: 10,
      },
      "“agentic ai”",
    ],
  ] as const)("%j → %s", (config, expected) => {
    expect(sourceDisplayName(config)).toBe(expected);
  });
});

// P9 (REQ-073): enabled sources ROWS → the run's collectors payload.
// Unique bugs this guards that the worker integration test can't isolate:
// multi-row aggregation (reddit subreddits, twitter users/lists, web sources),
// kind-based (not row-type-based) discrimination, and skipping unresolved
// twitter users (no userId yet).
describe("collectorsFromSources", () => {
  it("aggregates rows of each kind into one collectors payload", async () => {
    const { collectorsFromSources } = await import("@shared/types/source.js");
    const collectors = collectorsFromSources([
      { kind: "hn", sinceDays: 2, pointsThreshold: 50 },
      { kind: "reddit", subreddit: "LocalLLaMA", sort: "top", limit: 25, sinceDays: 1 },
      { kind: "reddit", subreddit: "MachineLearning", sinceDays: 1 },
      { kind: "web", name: "vLLM", listingUrl: "https://vllm.ai/blog", maxItems: 5 },
      { kind: "web", name: "Anthropic", listingUrl: "https://anthropic.com/research" },
      { kind: "twitter_user", handle: "sama", userId: "42", maxTweetsPerSource: 30, sinceHours: 24 },
      { kind: "twitter_user", handle: "unresolved" }, // no userId yet → skipped
      { kind: "twitter_list", listId: "158" },
      { kind: "web_search", provider: "tavily", query: "AI agents", sinceDays: 7, maxItems: 10 },
    ]);

    expect(collectors.hn).toEqual({ sinceDays: 2, pointsThreshold: 50 });
    expect(collectors.reddit).toEqual({
      subreddits: ["LocalLLaMA", "MachineLearning"],
      sort: "top",
      limit: 25,
      sinceDays: 1,
    });
    expect(collectors.web).toEqual({
      sources: [
        { name: "vLLM", listingUrl: "https://vllm.ai/blog" },
        { name: "Anthropic", listingUrl: "https://anthropic.com/research" },
      ],
      maxItems: 5,
    });
    expect(collectors.twitter).toEqual({
      listIds: ["158"],
      users: [{ handle: "sama", userId: "42" }],
      maxTweetsPerSource: 30,
      sinceHours: 24,
    });
    expect(collectors.webSearch).toEqual({
      provider: "tavily",
      queries: [{ query: "AI agents", sinceDays: 7, maxItems: 10 }],
    });
  });

  it("returns an empty payload for no rows and omits twitter when no row is collectable", async () => {
    const { collectorsFromSources } = await import("@shared/types/source.js");
    expect(collectorsFromSources([])).toEqual({});
    const onlyUnresolved = collectorsFromSources([
      { kind: "twitter_user", handle: "nobody" },
    ]);
    expect(onlyUnresolved.twitter).toBeUndefined();
  });
});
